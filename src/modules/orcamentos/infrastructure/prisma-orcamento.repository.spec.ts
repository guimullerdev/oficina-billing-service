import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { Dinheiro } from '../domain/dinheiro.vo';
import { Orcamento, TipoItemOrcamento } from '../domain/orcamento.entity';
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
  itens: [],
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

  it('findById returns domain (with items) or null', async () => {
    model.findUnique.mockResolvedValueOnce(row);
    expect((await repo.findById('id-1'))?.osId).toBe('os-1');
    expect(model.findUnique).toHaveBeenCalledWith({
      where: { id: 'id-1' },
      include: { itens: true },
    });
    model.findUnique.mockResolvedValueOnce(null);
    expect(await repo.findById('x')).toBeNull();
  });

  it('findByOsId returns domain (with items) or null', async () => {
    model.findUnique.mockResolvedValueOnce(row);
    expect((await repo.findByOsId('os-1'))?.id).toBe('id-1');
    expect(model.findUnique).toHaveBeenCalledWith({
      where: { osId: 'os-1' },
      include: { itens: true },
    });
    model.findUnique.mockResolvedValueOnce(null);
    expect(await repo.findByOsId('x')).toBeNull();
  });

  it('findByOsId uses tx when provided', async () => {
    const txFind = jest.fn().mockResolvedValue(null);
    const tx = {
      orcamento: { findUnique: txFind },
    } as unknown as Prisma.TransactionClient;
    expect(await repo.findByOsId('os-1', tx)).toBeNull();
    expect(txFind).toHaveBeenCalledTimes(1);
    expect(model.findUnique).not.toHaveBeenCalled();
  });

  it('save upserts via PrismaService by default (no items)', async () => {
    await repo.save(orcamento);
    const arg = model.upsert.mock.calls[0][0] as {
      where: unknown;
      create: Record<string, unknown>;
    };
    expect(arg.where).toEqual({ id: orcamento.id });
    expect(arg.create).not.toHaveProperty('itens');
  });

  it('save creates items only on the create branch', async () => {
    const comItens = Orcamento.create({
      osId: 'os-2',
      valorTotal: Dinheiro.create(30),
      itens: [
        {
          tipo: TipoItemOrcamento.PECA,
          refId: 'p-1',
          descricao: 'Pastilha',
          quantidade: 1,
          precoUnitario: Dinheiro.create(30),
        },
      ],
    });
    await repo.save(comItens);
    const arg = model.upsert.mock.calls[0][0] as {
      create: { itens: { createMany: { data: unknown[] } } };
      update: Record<string, unknown>;
    };
    expect(arg.create.itens.createMany.data).toEqual([
      expect.objectContaining({ id: comItens.itens[0].id, refId: 'p-1' }),
    ]);
    expect(arg.update).not.toHaveProperty('itens');
    expect(arg.update).not.toHaveProperty('id');
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
