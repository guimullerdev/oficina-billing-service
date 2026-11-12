import { Logger } from '@nestjs/common';

import { IncomingMessage, MessageHandler } from './message-handler.interface';

/**
 * Handler provisório: apenas registra o evento recebido. Existe para que a
 * idempotência grave o evento como processado em vez de cair em
 * UnknownEventError (e ir para a DLQ). As Fases 5/7 o substituem pelos
 * handlers reais de cada evento.
 */
export class LogOnlyHandler implements MessageHandler {
  private readonly logger = new Logger(LogOnlyHandler.name);

  constructor(readonly evento: string) {}

  handle(message: IncomingMessage): Promise<void> {
    this.logger.log(
      `evento=${this.evento} eventId=${message.eventId} correlationId=${message.correlationId}`,
    );
    return Promise.resolve();
  }
}

export const LOG_ONLY_EVENTOS = [
  'os.criada',
  'diagnostico.concluido',
  'os.cobranca.solicitada',
] as const;
