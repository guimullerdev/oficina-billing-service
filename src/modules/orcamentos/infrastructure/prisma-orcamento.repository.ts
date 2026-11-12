import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { Orcamento } from '../domain/orcamento.entity';
import { OrcamentoRepository } from '../domain/orcamento.repository';
import { OrcamentoMapper } from './orcamento.mapper';

const INCLUDE_ITENS = { itens: true } as const;

@Injectable()
export class PrismaOrcamentoRepository implements OrcamentoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Orcamento | null> {
    const row = await this.prisma.orcamento.findUnique({
      where: { id },
      include: INCLUDE_ITENS,
    });
    return row ? OrcamentoMapper.toDomain(row) : null;
  }

  async findByOsId(
    osId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Orcamento | null> {
    const client = tx ?? this.prisma;
    const row = await client.orcamento.findUnique({
      where: { osId },
      include: INCLUDE_ITENS,
    });
    return row ? OrcamentoMapper.toDomain(row) : null;
  }

  /**
   * Os itens são um snapshot gravado apenas na criação (mesmo statement do
   * insert do orçamento); atualizações tocam só os campos do orçamento.
   */
  async save(
    orcamento: Orcamento,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const data = OrcamentoMapper.toPersistence(orcamento);
    const itens = OrcamentoMapper.itensToPersistence(orcamento);
    const { id, ...update } = data;
    await client.orcamento.upsert({
      where: { id },
      create:
        itens.length > 0
          ? { ...data, itens: { createMany: { data: itens } } }
          : data,
      update,
    });
  }
}
