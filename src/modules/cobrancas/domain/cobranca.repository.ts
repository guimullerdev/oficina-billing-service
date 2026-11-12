import type { Prisma } from '@prisma/client';

import { Cobranca } from './cobranca.entity';

export interface CobrancaRepository {
  findByOsId(
    osId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Cobranca | null>;
  findByGatewayPaymentId(
    gatewayPaymentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Cobranca | null>;
  save(cobranca: Cobranca, tx?: Prisma.TransactionClient): Promise<void>;
}

export const COBRANCA_REPOSITORY = Symbol('CobrancaRepository');
