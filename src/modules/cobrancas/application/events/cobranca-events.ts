import { randomUUID } from 'crypto';

import { DomainEvent } from '../../../../shared/messaging/domain-event';
import { Cobranca } from '../../domain/cobranca.entity';

export const COBRANCA_AGGREGATE_TYPE = 'cobranca';
export const PAGAMENTO_RECUSADO = 'pagamento.recusado';

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
