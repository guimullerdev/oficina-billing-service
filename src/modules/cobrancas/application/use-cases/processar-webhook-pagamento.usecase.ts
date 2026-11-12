import { Logger } from '@nestjs/common';

import { PrismaService } from '../../../../prisma/prisma.service';
import { OutboxWriter } from '../../../../shared/messaging/outbox.writer';
import { StatusCobranca } from '../../domain/cobranca.entity';
import { CobrancaRepository } from '../../domain/cobranca.repository';
import { CobrancaNaoEncontradaError } from '../errors/cobranca-nao-encontrada.error';
import {
  buildResultadoPagamentoEvent,
  MOTIVO_PAGAMENTO_RECUSADO,
  StatusFinalPagamento,
} from '../events/cobranca-events';
import { PaymentGateway } from '../ports/payment-gateway.port';

export interface WebhookPagamentoResult {
  status: StatusCobranca;
}

/**
 * Processa o webhook de pagamento do gateway. O corpo do webhook serve só
 * como gatilho: o status é sempre reconsultado no gateway (fonte da verdade).
 *
 * Idempotente: cobrança já CONFIRMADA/RECUSADA é no-op e a transição usa um
 * update condicional (`status = PENDENTE`), de modo que só a requisição que
 * efetivamente muda o status grava o evento no outbox (mesma transação).
 *
 * Erros do gateway são propagados para o chamador (503 quando indisponível),
 * permitindo uma nova tentativa sem nada ter sido gravado.
 */
export class ProcessarWebhookPagamentoUseCase {
  private readonly logger = new Logger(ProcessarWebhookPagamentoUseCase.name);

  constructor(
    private readonly cobrancas: CobrancaRepository,
    private readonly gateway: PaymentGateway,
    private readonly prisma: PrismaService,
    private readonly outboxWriter: OutboxWriter,
  ) {}

  async execute(
    paymentId: string,
    statusInformado?: string,
  ): Promise<WebhookPagamentoResult> {
    const cobranca = await this.cobrancas.findByGatewayPaymentId(paymentId);
    if (!cobranca) {
      throw new CobrancaNaoEncontradaError(`gatewayPaymentId=${paymentId}`);
    }
    if (cobranca.status !== StatusCobranca.PENDENTE) {
      this.logger.log(
        `Webhook do pagamento ${paymentId} ignorado: cobrança ${cobranca.id} já está ${cobranca.status}`,
      );
      return { status: cobranca.status };
    }

    const pagamento = await this.gateway.consultarPagamento(paymentId);
    if (statusInformado !== undefined && statusInformado !== pagamento.status) {
      this.logger.warn(
        `Status do webhook (${statusInformado}) diverge do gateway (${pagamento.status}) para o pagamento ${paymentId}; prevalece o gateway`,
      );
    }
    if (pagamento.status === 'pending') {
      this.logger.log(
        `Pagamento ${paymentId} ainda pendente no gateway; nada a fazer`,
      );
      return { status: StatusCobranca.PENDENTE };
    }

    const novoStatus: StatusFinalPagamento =
      pagamento.status === 'approved'
        ? StatusCobranca.CONFIRMADA
        : StatusCobranca.RECUSADA;
    const event = buildResultadoPagamentoEvent(cobranca, novoStatus, {
      correlationId: cobranca.correlationId,
    });

    const aplicado = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.cobranca.updateMany({
        where: { id: cobranca.id, status: StatusCobranca.PENDENTE },
        data:
          novoStatus === StatusCobranca.RECUSADA
            ? { status: novoStatus, motivo: MOTIVO_PAGAMENTO_RECUSADO }
            : { status: novoStatus },
      });
      if (count !== 1) return false;
      await this.outboxWriter.append(tx, [event]);
      return true;
    });

    if (aplicado) {
      this.logger.log(
        `Cobrança ${cobranca.id} (osId=${cobranca.osId}) ${novoStatus}; evento ${event.evento} gravado no outbox`,
      );
    } else {
      this.logger.log(
        `Cobrança ${cobranca.id} já foi atualizada por outra requisição; nenhum evento gravado`,
      );
    }
    return { status: novoStatus };
  }
}
