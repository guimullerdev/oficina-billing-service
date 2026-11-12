import { Prisma, Orcamento as OrcamentoRow } from '@prisma/client';
import { Dinheiro } from '../domain/dinheiro.vo';
import { Orcamento, StatusOrcamento } from '../domain/orcamento.entity';

export class OrcamentoMapper {
  static toDomain(row: OrcamentoRow): Orcamento {
    return Orcamento.restore({
      id: row.id,
      osId: row.osId,
      clienteId: row.clienteId ?? undefined,
      status: row.status as StatusOrcamento,
      valorTotal: Dinheiro.create(row.valorTotal.toNumber()),
      motivoReprovacao: row.motivoReprovacao ?? undefined,
      correlationId: row.correlationId ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static toPersistence(orcamento: Orcamento): OrcamentoRow {
    return {
      id: orcamento.id,
      osId: orcamento.osId,
      clienteId: orcamento.clienteId ?? null,
      status: orcamento.status,
      valorTotal: new Prisma.Decimal(orcamento.valorTotal.getValue()),
      motivoReprovacao: orcamento.motivoReprovacao ?? null,
      correlationId: orcamento.correlationId ?? null,
      createdAt: orcamento.createdAt,
      updatedAt: orcamento.updatedAt,
    };
  }
}
