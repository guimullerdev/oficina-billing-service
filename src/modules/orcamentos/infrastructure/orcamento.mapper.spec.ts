import { Prisma } from '@prisma/client';
import { OrcamentoMapper } from './orcamento.mapper';
import { Dinheiro } from '../domain/dinheiro.vo';
import {
  Orcamento,
  StatusOrcamento,
  TipoItemOrcamento,
} from '../domain/orcamento.entity';

const now = new Date();
const row = {
  id: 'id-1',
  osId: 'os-1',
  clienteId: null,
  status: 'REPROVADO' as const,
  valorTotal: new Prisma.Decimal('123.45'),
  motivoReprovacao: 'caro',
  correlationId: null,
  createdAt: now,
  updatedAt: now,
};

const itemRow = {
  id: 'it-1',
  orcamentoId: 'id-1',
  tipo: 'PECA' as const,
  refId: 'peca-1',
  descricao: 'Filtro',
  quantidade: 3,
  precoUnitario: new Prisma.Decimal('10.15'),
};

describe('OrcamentoMapper', () => {
  it('maps row to domain', () => {
    const o = OrcamentoMapper.toDomain(row);
    expect(o.status).toBe(StatusOrcamento.REPROVADO);
    expect(o.valorTotal.getValue()).toBe(123.45);
    expect(o.clienteId).toBeUndefined();
    expect(o.correlationId).toBeUndefined();
    expect(o.motivoReprovacao).toBe('caro');
    expect(o.itens).toEqual([]);
  });

  it('maps item rows to domain items', () => {
    const o = OrcamentoMapper.toDomain({ ...row, itens: [itemRow] });
    expect(o.itens).toHaveLength(1);
    expect(o.itens[0]).toMatchObject({
      id: 'it-1',
      tipo: TipoItemOrcamento.PECA,
      refId: 'peca-1',
      descricao: 'Filtro',
      quantidade: 3,
    });
    expect(o.itens[0].precoUnitario.getValue()).toBe(10.15);
  });

  it('round-trips to persistence', () => {
    const p = OrcamentoMapper.toPersistence(OrcamentoMapper.toDomain(row));
    expect(p.valorTotal.toString()).toBe('123.45');
    expect(p.clienteId).toBeNull();
    expect(p.correlationId).toBeNull();
    expect(p).toMatchObject({ id: 'id-1', osId: 'os-1', status: 'REPROVADO' });
  });

  it('maps items to persistence (without orcamentoId)', () => {
    const o = Orcamento.create({
      osId: 'os-1',
      valorTotal: Dinheiro.create(20.3),
      itens: [
        {
          tipo: TipoItemOrcamento.SERVICO,
          refId: 'srv-1',
          descricao: 'Alinhamento',
          quantidade: 2,
          precoUnitario: Dinheiro.create(10.15),
        },
      ],
    });
    const [item] = OrcamentoMapper.itensToPersistence(o);
    expect(item).toEqual({
      id: o.itens[0].id,
      tipo: 'SERVICO',
      refId: 'srv-1',
      descricao: 'Alinhamento',
      quantidade: 2,
      precoUnitario: new Prisma.Decimal('10.15'),
    });
  });
});
