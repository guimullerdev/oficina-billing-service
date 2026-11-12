import {
  Prisma,
  Orcamento as OrcamentoRow,
  OrcamentoItem as OrcamentoItemRow,
} from '@prisma/client';
import { Dinheiro } from '../domain/dinheiro.vo';
import {
  Orcamento,
  StatusOrcamento,
  TipoItemOrcamento,
} from '../domain/orcamento.entity';

export type OrcamentoComItensRow = OrcamentoRow & {
  itens?: OrcamentoItemRow[];
};

export type OrcamentoItemPersistence = Omit<OrcamentoItemRow, 'orcamentoId'>;

export class OrcamentoMapper {
  static toDomain(row: OrcamentoComItensRow): Orcamento {
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
      itens: (row.itens ?? []).map((item) => ({
        id: item.id,
        tipo: item.tipo as TipoItemOrcamento,
        refId: item.refId,
        descricao: item.descricao,
        quantidade: item.quantidade,
        precoUnitario: Dinheiro.create(item.precoUnitario.toNumber()),
      })),
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

  static itensToPersistence(orcamento: Orcamento): OrcamentoItemPersistence[] {
    return orcamento.itens.map((item) => ({
      id: item.id,
      tipo: item.tipo,
      refId: item.refId,
      descricao: item.descricao,
      quantidade: item.quantidade,
      precoUnitario: new Prisma.Decimal(item.precoUnitario.getValue()),
    }));
  }
}
