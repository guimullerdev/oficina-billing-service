import type { Prisma } from '@prisma/client';
import { Orcamento } from './orcamento.entity';

export interface OrcamentoRepository {
  findById(id: string): Promise<Orcamento | null>;
  findByOsId(
    osId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Orcamento | null>;
  save(orcamento: Orcamento, tx?: Prisma.TransactionClient): Promise<void>;
}

export const ORCAMENTO_REPOSITORY = Symbol('OrcamentoRepository');
