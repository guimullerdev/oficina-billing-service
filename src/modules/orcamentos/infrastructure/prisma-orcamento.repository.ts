import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { Orcamento } from '../domain/orcamento.entity';
import { OrcamentoRepository } from '../domain/orcamento.repository';
import { OrcamentoMapper } from './orcamento.mapper';

@Injectable()
export class PrismaOrcamentoRepository implements OrcamentoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<Orcamento | null> {
    const row = await this.prisma.orcamento.findUnique({ where: { id } });
    return row ? OrcamentoMapper.toDomain(row) : null;
  }

  async findByOsId(osId: string): Promise<Orcamento | null> {
    const row = await this.prisma.orcamento.findUnique({ where: { osId } });
    return row ? OrcamentoMapper.toDomain(row) : null;
  }

  async save(
    orcamento: Orcamento,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const data = OrcamentoMapper.toPersistence(orcamento);
    const { id, ...update } = data;
    await client.orcamento.upsert({
      where: { id },
      create: data,
      update,
    });
  }
}
