import { randomUUID } from 'crypto';

import { DomainEvent } from '../../../../shared/messaging/domain-event';
import { Cobranca, StatusCobranca } from '../../domain/cobranca.entity';

export const COBRANCA_AGGREGATE_TYPE = 'cobranca';
export const PAGAMENTO_RECUSADO = 'pagamento.recusado';
export const PAGAMENTO_CONFIRMADO = 'pagamento.confirmado';
/** Motivo gravado quando o próprio gateway recusa o pagamento. */
export const MOTIVO_PAGAMENTO_RECUSADO = 'pagamento_recusado';

export type StatusFinalPagamento =
  StatusCobranca.CONFIRMADA | StatusCobranca.RECUSADA;

export interface EventContext {
  correlationId?: string;
  traceparent?: string;
}

/**
 * `pagamento.recusado` emitido quando a cobrança é recusada antes de chegar ao
 * gateway (orçamento inexistente, não aprovado ou com valor zero). O payload
 * segue o contrato da saga: `cobrancaId` é null porque nenhuma cobrança foi
 * aberta no gateway; o id da cobrança RECUSADA gravada vai em `aggregateId`.
 */
export function buildPagamentoRecusadoEvent(
  cobranca: Cobranca,
  ctx: EventContext,
): DomainEvent {
  return {
    evento: PAGAMENTO_RECUSADO,
    aggregateType: COBRANCA_AGGREGATE_TYPE,
    aggregateId: cobranca.id,
    payload: {
      osId: cobranca.osId,
      cobrancaId: null,
      valor: cobranca.valor,
      status: cobranca.status,
      motivo: cobranca.motivo,
    },
    correlationId: ctx.correlationId ?? randomUUID(),
    traceparent: ctx.traceparent,
  };
}

/**
 * `pagamento.confirmado` / `pagamento.recusado` emitido quando o gateway
 * decide o pagamento de uma cobrança PENDENTE (webhook). Aqui a cobrança foi
 * aberta no gateway, então `cobrancaId` é o id dela.
 */
export function buildResultadoPagamentoEvent(
  cobranca: Cobranca,
  status: StatusFinalPagamento,
  ctx: EventContext,
): DomainEvent {
  const confirmado = status === StatusCobranca.CONFIRMADA;
  return {
    evento: confirmado ? PAGAMENTO_CONFIRMADO : PAGAMENTO_RECUSADO,
    aggregateType: COBRANCA_AGGREGATE_TYPE,
    aggregateId: cobranca.id,
    payload: {
      osId: cobranca.osId,
      cobrancaId: cobranca.id,
      valor: cobranca.valor,
      status,
      ...(confirmado ? {} : { motivo: MOTIVO_PAGAMENTO_RECUSADO }),
    },
    correlationId: ctx.correlationId ?? randomUUID(),
    traceparent: ctx.traceparent,
  };
}
