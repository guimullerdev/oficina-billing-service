import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { OutboxWriter } from '../../../../shared/messaging/outbox.writer';
import {
  Orcamento,
  StatusOrcamento,
} from '../../../orcamentos/domain/orcamento.entity';
import { OrcamentoRepository } from '../../../orcamentos/domain/orcamento.repository';
import { Cobranca } from '../../domain/cobranca.entity';
import { CobrancaRepository } from '../../domain/cobranca.repository';
import { buildPagamentoRecusadoEvent } from '../events/cobranca-events';
import { PaymentGateway } from '../ports/payment-gateway.port';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';
const CURRENCY = 'BRL';

export type MotivoRecusa =
  'orcamento_inexistente' | 'orcamento_nao_aprovado' | 'valor_zero';

export interface SolicitarCobrancaInput {
  osId: string;
  sagaId: string;
  correlationId?: string;
  traceparent?: string;
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === UNIQUE_CONSTRAINT_VIOLATION;

function motivoRecusa(orcamento: Orcamento | null): MotivoRecusa | null {
  if (!orcamento) return 'orcamento_inexistente';
  if (orcamento.status !== StatusOrcamento.APROVADO) {
    return 'orcamento_nao_aprovado';
  }
  if (orcamento.valorTotal.getValue() === 0) return 'valor_zero';
  return null;
}

/**
 * Abre a cobrança de uma OS (passo COBRAR da saga). Idempotente por `osId`:
 * se já existe cobrança para a OS (PENDENTE, CONFIRMADA ou RECUSADA), nada é
 * feito.
 *
 * Trade-off: a chamada HTTP ao gateway acontece dentro da transação do
 * IdempotentProcessor (que precisa envolver o registro do eventId e a
 * gravação da cobrança). Isso segura uma conexão do pool durante a chamada
 * (limitada pelo timeout do adapter) e, se o commit falhar depois do
 * pagamento criado, a mensagem é reentregue. A reentrega é segura porque a
 * Idempotency-Key `${sagaId}:${osId}` faz o gateway devolver o mesmo
 * pagamento em vez de criar outro.
 */
export class SolicitarCobrancaUseCase {
  private readonly logger = new Logger(SolicitarCobrancaUseCase.name);

  constructor(
    private readonly cobrancas: CobrancaRepository,
    private readonly orcamentos: OrcamentoRepository,
    private readonly gateway: PaymentGateway,
    private readonly outboxWriter: OutboxWriter,
  ) {}

  async execute(
    input: SolicitarCobrancaInput,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const existente = await this.cobrancas.findByOsId(input.osId, tx);
    if (existente) {
      this.logger.log(
        `Cobrança já existe para osId=${input.osId} (cobrancaId=${existente.id}, status=${existente.status}); nada a fazer`,
      );
      return;
    }

    const orcamento = await this.orcamentos.findByOsId(input.osId, tx);
    const motivo = motivoRecusa(orcamento);
    if (motivo) {
      await this.recusar(input, orcamento, motivo, tx);
      return;
    }
    await this.abrirNoGateway(input, orcamento as Orcamento, tx);
  }

  private async recusar(
    input: SolicitarCobrancaInput,
    orcamento: Orcamento | null,
    motivo: MotivoRecusa,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const cobranca = Cobranca.recusada({
      osId: input.osId,
      orcamentoId: orcamento?.id,
      valor: orcamento?.valorTotal.getValue() ?? 0,
      motivo,
      correlationId: input.correlationId,
      sagaId: input.sagaId,
    });
    this.logger.warn(
      `Cobrança recusada para osId=${input.osId}: motivo=${motivo}`,
    );
    if (!(await this.persistir(cobranca, tx))) return;
    await this.outboxWriter.append(tx, [
      buildPagamentoRecusadoEvent(cobranca, input),
    ]);
  }

  private async abrirNoGateway(
    input: SolicitarCobrancaInput,
    orcamento: Orcamento,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const valor = orcamento.valorTotal.getValue();
    // Erros do gateway (indisponível, conflito) são propagados: a transação é
    // desfeita e a mensagem volta para a fila (DLQ após as reentregas).
    const pagamento = await this.gateway.criarPagamento({
      idempotencyKey: `${input.sagaId}:${input.osId}`,
      amountCents: Math.round(valor * 100),
      currency: CURRENCY,
      description: `OS ${input.osId}`,
      metadata: {
        osId: input.osId,
        orcamentoId: orcamento.id,
        sagaId: input.sagaId,
      },
    });

    const cobranca = Cobranca.pendente({
      osId: input.osId,
      orcamentoId: orcamento.id,
      valor,
      gatewayPaymentId: pagamento.id,
      checkoutUrl: pagamento.checkoutUrl,
      correlationId: input.correlationId,
      sagaId: input.sagaId,
    });
    if (await this.persistir(cobranca, tx)) {
      this.logger.log(
        `Cobrança PENDENTE criada para osId=${input.osId} (gatewayPaymentId=${pagamento.id})`,
      );
    }
  }

  /**
   * `false` quando a corrida na unicidade de `os_id` foi perdida: outra
   * entrega já criou a cobrança (a transação fica inutilizável no Postgres,
   * então nada mais é gravado).
   */
  private async persistir(
    cobranca: Cobranca,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    try {
      await this.cobrancas.save(cobranca, tx);
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.logger.warn(
          `Cobrança criada concorrentemente para osId=${cobranca.osId}; nada a fazer`,
        );
        return false;
      }
      throw error;
    }
  }
}
