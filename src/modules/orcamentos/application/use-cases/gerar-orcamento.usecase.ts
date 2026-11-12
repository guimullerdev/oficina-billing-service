import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { OutboxWriter } from '../../../../shared/messaging/outbox.writer';
import { Dinheiro } from '../../domain/dinheiro.vo';
import {
  NovoOrcamentoItem,
  Orcamento,
  TipoItemOrcamento,
} from '../../domain/orcamento.entity';
import { OrcamentoRepository } from '../../domain/orcamento.repository';
import { buildOrcamentoEvent } from '../events/orcamento-events';

const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

export interface ItemOrcamentoInput {
  tipo: TipoItemOrcamento;
  refId: string;
  descricao: string;
  quantidade: number;
  precoUnitario: number;
}

export interface GerarOrcamentoInput {
  osId: string;
  clienteId?: string;
  itens?: ItemOrcamentoInput[];
  valorTotal?: number;
  correlationId?: string;
  traceparent?: string;
}

/**
 * Gera o orçamento (GERADO) de uma OS a partir do diagnóstico concluído e
 * grava `orcamento.gerado` no outbox. Roda inteiramente na transação recebida
 * (a mesma em que a idempotência por `eventId` foi registrada).
 *
 * Idempotente por `osId`: se já existe orçamento para a OS (outro `eventId`
 * para a mesma OS, ou corrida perdida na unicidade de `os_id`), nada é gravado.
 */
export class GerarOrcamentoUseCase {
  private readonly logger = new Logger(GerarOrcamentoUseCase.name);

  constructor(
    private readonly repo: OrcamentoRepository,
    private readonly outboxWriter: OutboxWriter,
  ) {}

  /**
   * Retorna o orçamento criado ou o já existente; `null` quando a corrida na
   * unicidade de `os_id` foi perdida (a transação fica inutilizável no
   * Postgres, então não é possível reler o orçamento vencedor).
   */
  async execute(
    input: GerarOrcamentoInput,
    tx: Prisma.TransactionClient,
  ): Promise<Orcamento | null> {
    const existente = await this.repo.findByOsId(input.osId, tx);
    if (existente) {
      this.logger.log(
        `Orçamento já existe para osId=${input.osId} (orcamentoId=${existente.id}); nada a fazer`,
      );
      return existente;
    }

    const itens = input.itens?.map((item): NovoOrcamentoItem => ({
      ...item,
      precoUnitario: Dinheiro.create(item.precoUnitario),
    }));
    const correlationId = input.correlationId ?? randomUUID();
    const orcamento = Orcamento.create({
      osId: input.osId,
      clienteId: input.clienteId,
      valorTotal: this.calcularValorTotal(input, itens),
      correlationId,
      itens,
    });
    const event = buildOrcamentoEvent(
      'orcamento.gerado',
      orcamento,
      {},
      { correlationId, traceparent: input.traceparent },
    );

    try {
      await this.repo.save(orcamento, tx);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        this.logger.warn(
          `Orçamento criado concorrentemente para osId=${input.osId}; nada a fazer`,
        );
        return null;
      }
      throw error;
    }
    await this.outboxWriter.append(tx, [event]);
    return orcamento;
  }

  private calcularValorTotal(
    input: GerarOrcamentoInput,
    itens: NovoOrcamentoItem[] | undefined,
  ): Dinheiro {
    if (!itens) {
      // D-BIL-1: payload antigo do os-service ({ id, status }) não traz itens.
      this.logger.warn(
        `diagnostico.concluido sem itens para osId=${input.osId}; orçamento gerado com valorTotal 0 (D-BIL-1)`,
      );
      return Dinheiro.create(0);
    }
    if (input.valorTotal !== undefined) {
      return Dinheiro.create(input.valorTotal);
    }
    const centavos = itens.reduce(
      (total, item) =>
        total +
        Math.round(item.precoUnitario.getValue() * 100) * item.quantidade,
      0,
    );
    return Dinheiro.create(centavos / 100);
  }
}
