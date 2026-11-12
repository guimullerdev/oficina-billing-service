import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { Cobranca } from '../domain/cobranca.entity';
import { CobrancaRepository } from '../domain/cobranca.repository';
import { CobrancaMapper } from './cobranca.mapper';

@Injectable()
export class PrismaCobrancaRepository implements CobrancaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByOsId(
    osId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Cobranca | null> {
    const row = await (tx ?? this.prisma).cobranca.findUnique({
      where: { osId },
    });
    return row ? CobrancaMapper.toDomain(row) : null;
  }

  async findByGatewayPaymentId(
    gatewayPaymentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Cobranca | null> {
    const row = await (tx ?? this.prisma).cobranca.findUnique({
      where: { gatewayPaymentId },
    });
    return row ? CobrancaMapper.toDomain(row) : null;
  }

  /** Upsert por id; a unicidade de `os_id` gera P2002 numa criação duplicada. */
  async save(cobranca: Cobranca, tx?: Prisma.TransactionClient): Promise<void> {
    const data = CobrancaMapper.toPersistence(cobranca);
    const { id, ...update } = data;
    await (tx ?? this.prisma).cobranca.upsert({
      where: { id },
      create: data,
      update,
    });
  }
}
