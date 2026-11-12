import { Cobranca, StatusCobranca } from '../../domain/cobranca.entity';

export interface CobrancaOutput {
  id: string;
  osId: string;
  orcamentoId: string | null;
  status: StatusCobranca;
  valor: number;
  checkoutUrl: string | null;
  motivo: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function toCobrancaOutput(cobranca: Cobranca): CobrancaOutput {
  return {
    id: cobranca.id,
    osId: cobranca.osId,
    orcamentoId: cobranca.orcamentoId ?? null,
    status: cobranca.status,
    valor: cobranca.valor,
    checkoutUrl: cobranca.checkoutUrl ?? null,
    motivo: cobranca.motivo ?? null,
    createdAt: cobranca.createdAt,
    updatedAt: cobranca.updatedAt,
  };
}
