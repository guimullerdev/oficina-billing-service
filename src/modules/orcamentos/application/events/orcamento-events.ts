import { randomUUID } from 'crypto';

import { DomainEvent } from '../../../../shared/messaging/domain-event';
import { Orcamento } from '../../domain/orcamento.entity';

export interface EventContext {
  correlationId?: string;
  traceparent?: string;
}

export const ORCAMENTO_AGGREGATE_TYPE = 'orcamento';

/**
 * Monta o evento do orçamento (geração ou decisão). O correlationId da saga
 * (gravado no orçamento) tem precedência; na ausência, segue a convenção do
 * os-service (contexto da requisição ou um UUID novo).
 */
export function buildOrcamentoEvent(
  evento: 'orcamento.gerado' | 'orcamento.aprovado' | 'orcamento.reprovado',
  orcamento: Orcamento,
  extraPayload: Record<string, unknown>,
  ctx?: EventContext,
): DomainEvent {
  return {
    evento,
    aggregateType: ORCAMENTO_AGGREGATE_TYPE,
    aggregateId: orcamento.id,
    payload: {
      osId: orcamento.osId,
      orcamentoId: orcamento.id,
      valorTotal: orcamento.valorTotal.getValue(),
      status: orcamento.status,
      ...extraPayload,
    },
    correlationId:
      orcamento.correlationId ?? ctx?.correlationId ?? randomUUID(),
    traceparent: ctx?.traceparent,
  };
}
