import { Orcamento, StatusOrcamento } from '../../domain/orcamento.entity';

export interface OrcamentoOutput {
  id: string;
  osId: string;
  clienteId: string | null;
  status: StatusOrcamento;
  valorTotal: number;
  motivoReprovacao: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toOrcamentoOutput(orcamento: Orcamento): OrcamentoOutput {
  return {
    id: orcamento.id,
    osId: orcamento.osId,
    clienteId: orcamento.clienteId ?? null,
    status: orcamento.status,
    valorTotal: orcamento.valorTotal.getValue(),
    motivoReprovacao: orcamento.motivoReprovacao ?? null,
    createdAt: orcamento.createdAt,
    updatedAt: orcamento.updatedAt,
  };
}
