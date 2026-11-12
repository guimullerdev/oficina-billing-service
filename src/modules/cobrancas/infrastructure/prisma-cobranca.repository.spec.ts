import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';
import { Cobranca, StatusCobranca } from '../domain/cobranca.entity';
import { CobrancaMapper } from './cobranca.mapper';
import { PrismaCobrancaRepository } from './prisma-cobranca.repository';

const now = new Date('2026-01-01T00:00:00Z');
const row = {
  id: 'id-1',
  osId: 'os-1',
  orcamentoId: null,
  gatewayPaymentId: 'pay-1',
  valor: new Prisma.Decimal('150.50'),
  status: 'PENDENTE' as const,
  checkoutUrl: 'http://x',
  correlationId: null,
  sagaId: 'saga-1',
  motivo: null,
  createdAt: now,
  updatedAt: now,
};

describe('CobrancaMapper', () => {
  it('maps a row to the domain (nulls become undefined)', () => {
    const c = CobrancaMapper.toDomain(row);

    expect(c.id).toBe('id-1');
    expect(c.valor).toBe(150.5);
    expect(c.status).toBe(StatusCobranca.PENDENTE);
    expect(c.orcamentoId).toBeUndefined();
    expect(c.correlationId).toBeUndefined();
    expect(c.motivo).toBeUndefined();
    expect(c.gatewayPaymentId).toBe('pay-1');
  });

  it('round-trips domain -> row -> domain', () => {
    const c = Cobranca.recusada({
      osId: 'os-2',
      orcamentoId: 'orc-2',
      valor: 99.9,
      motivo: 'orcamento_nao_aprovado',
      correlationId: 'corr',
      sagaId: 'saga',
    });

    const persisted = CobrancaMapper.toPersistence(c);

    expect(persisted.valor.toString()).toBe('99.9');
    expect(persisted.gatewayPaymentId).toBeNull();
    expect(persisted.checkoutUrl).toBeNull();
    expect(CobrancaMapper.toDomain(persisted)).toEqual(c);
  });
});

describe('PrismaCobrancaRepository', () => {
  const model = { findUnique: jest.fn(), upsert: jest.fn() };
  const prisma = { cobranca: model } as unknown as PrismaService;
  const tx = { cobranca: { findUnique: jest.fn(), upsert: jest.fn() } };
  const repo = new PrismaCobrancaRepository(prisma);

  beforeEach(() => jest.resetAllMocks());

  it('findByOsId uses the tx when given and maps the row', async () => {
    tx.cobranca.findUnique.mockResolvedValueOnce(row);

    const c = await repo.findByOsId(
      'os-1',
      tx as unknown as Prisma.TransactionClient,
    );

    expect(c?.osId).toBe('os-1');
    expect(tx.cobranca.findUnique).toHaveBeenCalledWith({
      where: { osId: 'os-1' },
    });
    expect(model.findUnique).not.toHaveBeenCalled();
  });

  it('findByOsId falls back to the prisma client and returns null', async () => {
    model.findUnique.mockResolvedValueOnce(null);
    expect(await repo.findByOsId('os-x')).toBeNull();
  });

  it('findByGatewayPaymentId queries by gateway_payment_id', async () => {
    model.findUnique.mockResolvedValueOnce(row);
    expect((await repo.findByGatewayPaymentId('pay-1'))?.id).toBe('id-1');
    expect(model.findUnique).toHaveBeenCalledWith({
      where: { gatewayPaymentId: 'pay-1' },
    });
    model.findUnique.mockResolvedValueOnce(null);
    expect(await repo.findByGatewayPaymentId('nope')).toBeNull();
  });

  it('save upserts by id (create = full row, update = without id)', async () => {
    const c = CobrancaMapper.toDomain(row);

    await repo.save(c, tx as unknown as Prisma.TransactionClient);

    const data = CobrancaMapper.toPersistence(c);
    const { id, ...update } = data;
    expect(tx.cobranca.upsert).toHaveBeenCalledWith({
      where: { id },
      create: data,
      update,
    });
  });

  it('save without tx uses the prisma client', async () => {
    await repo.save(CobrancaMapper.toDomain(row));
    expect(model.upsert).toHaveBeenCalled();
  });
});
