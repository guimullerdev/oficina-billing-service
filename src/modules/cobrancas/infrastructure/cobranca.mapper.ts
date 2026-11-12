import { Prisma, Cobranca as CobrancaRow } from '@prisma/client';

import { Cobranca, StatusCobranca } from '../domain/cobranca.entity';

export class CobrancaMapper {
  static toDomain(row: CobrancaRow): Cobranca {
    return Cobranca.restore({
      id: row.id,
      osId: row.osId,
      orcamentoId: row.orcamentoId ?? undefined,
      gatewayPaymentId: row.gatewayPaymentId ?? undefined,
      valor: row.valor.toNumber(),
      status: row.status as StatusCobranca,
      checkoutUrl: row.checkoutUrl ?? undefined,
      correlationId: row.correlationId ?? undefined,
      sagaId: row.sagaId ?? undefined,
      motivo: row.motivo ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static toPersistence(cobranca: Cobranca): CobrancaRow {
    return {
      id: cobranca.id,
      osId: cobranca.osId,
      orcamentoId: cobranca.orcamentoId ?? null,
      gatewayPaymentId: cobranca.gatewayPaymentId ?? null,
      valor: new Prisma.Decimal(cobranca.valor),
      status: cobranca.status,
      checkoutUrl: cobranca.checkoutUrl ?? null,
      correlationId: cobranca.correlationId ?? null,
      sagaId: cobranca.sagaId ?? null,
      motivo: cobranca.motivo ?? null,
      createdAt: cobranca.createdAt,
      updatedAt: cobranca.updatedAt,
    };
  }
}
