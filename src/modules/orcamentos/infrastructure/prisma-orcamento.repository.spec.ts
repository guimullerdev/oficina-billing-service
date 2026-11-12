import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { Dinheiro } from '../domain/dinheiro.vo';
import { Orcamento } from '../domain/orcamento.entity';
import { PrismaOrcamentoRepository } from './prisma-orcamento.repository';

const now = new Date();
const row = {
  id: 'id-1',
  osId: 'os-1',
  clienteId: 'cli-1',
  status: 'GERADO' as const,
  valorTotal: new Prisma.Decimal('10.00'),
  motivoReprovacao: null,
  correlationId: null,
  createdAt: now,
  updatedAt: now,
};

describe('PrismaOrcamentoRepository', () => {
  const model = {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  };
  const prisma = { orcamento: model } as unknown as PrismaService;
  const repo = new PrismaOrcamentoRepository(prisma);
  const orcamento = Orcamento.create({
    osId: 'os-1',
    valorTotal: Dinheiro.create(10),
  });

  beforeEach(() => jest.resetAllMocks());

  it('findById returns domain or null', async () => {
    model.findUnique.mockResolvedValueOnce(row);
    expect((await repo.findById('id-1'))?.osId).toBe('os-1');
    expect(model.findUnique).toHaveBeenCalledWith({ where: { id: 'id-1' } });
    model.findUnique.mockResolvedValueOnce(null);
    expect(await repo.findById('x')).toBeNull();
  });

  it('findByOsId returns domain or null', async () => {
    model.findUnique.mockResolvedValueOnce(row);
    expect((await repo.findByOsId('os-1'))?.id).toBe('id-1');
    expect(model.findUnique).toHaveBeenCalledWith({ where: { osId: 'os-1' } });
    model.findUnique.mockResolvedValueOnce(null);
    expect(await repo.findByOsId('x')).toBeNull();
  });

  it('save upserts via PrismaService by default', async () => {
    await repo.save(orcamento);
    expect(model.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: orcamento.id } }),
    );
  });

  it('save uses tx when provided', async () => {
    const txUpsert = jest.fn();
    const tx = {
      orcamento: { upsert: txUpsert },
    } as unknown as Prisma.TransactionClient;
    await repo.save(orcamento, tx);
    expect(txUpsert).toHaveBeenCalledTimes(1);
    expect(model.upsert).not.toHaveBeenCalled();
  });
});
