import { Prisma } from '@prisma/client';

import {
  IncomingMessage,
  MessageHandler,
} from '../../../../shared/messaging/handlers/message-handler.interface';
import {
  SolicitarCobrancaInput,
  SolicitarCobrancaUseCase,
} from '../use-cases/solicitar-cobranca.usecase';

export const COBRANCA_SOLICITADA = 'os.cobranca.solicitada';

/**
 * Payload inválido: o erro é relançado pelo IdempotentProcessor, a mensagem
 * não é removida da fila e, após as reentregas, vai para a DLQ.
 */
export class CobrancaSolicitadaPayloadInvalidoError extends Error {
  constructor(motivo: string) {
    super(`Payload de os.cobranca.solicitada inválido: ${motivo}`);
    this.name = 'CobrancaSolicitadaPayloadInvalidoError';
  }
}

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;

/**
 * Payload do os-service: `{ id: osId, sagaId, ordem, nome, causadoPor }`.
 * Só `id` e `sagaId` são usados (o sagaId compõe a Idempotency-Key).
 */
export function parseCobrancaSolicitada(
  payload: unknown,
): Pick<SolicitarCobrancaInput, 'osId' | 'sagaId'> {
  if (typeof payload !== 'object' || payload === null) {
    throw new CobrancaSolicitadaPayloadInvalidoError(
      'payload deve ser um objeto',
    );
  }
  const { id, sagaId } = payload as Record<string, unknown>;
  if (!isNonEmptyString(id)) {
    throw new CobrancaSolicitadaPayloadInvalidoError('id (osId) ausente');
  }
  if (!isNonEmptyString(sagaId)) {
    throw new CobrancaSolicitadaPayloadInvalidoError('sagaId ausente');
  }
  return { osId: id, sagaId };
}

export class CobrancaSolicitadaHandler implements MessageHandler {
  readonly evento = COBRANCA_SOLICITADA;

  constructor(private readonly solicitarCobranca: SolicitarCobrancaUseCase) {}

  async handle(message: IncomingMessage, tx?: unknown): Promise<void> {
    if (!tx) {
      throw new Error(
        'os.cobranca.solicitada exige a transação do IdempotentProcessor',
      );
    }
    const dados = parseCobrancaSolicitada(message.payload);
    await this.solicitarCobranca.execute(
      {
        ...dados,
        correlationId: message.correlationId,
        traceparent: message.traceparent,
      },
      tx as Prisma.TransactionClient,
    );
  }
}
