import { Prisma } from '@prisma/client';
import { OrcamentoMapper } from './orcamento.mapper';
import { StatusOrcamento } from '../domain/orcamento.entity';

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

describe('OrcamentoMapper', () => {
  it('maps row to domain', () => {
    const o = OrcamentoMapper.toDomain(row);
    expect(o.status).toBe(StatusOrcamento.REPROVADO);
    expect(o.valorTotal.getValue()).toBe(123.45);
    expect(o.clienteId).toBeUndefined();
    expect(o.correlationId).toBeUndefined();
    expect(o.motivoReprovacao).toBe('caro');
  });

  it('round-trips to persistence', () => {
    const p = OrcamentoMapper.toPersistence(OrcamentoMapper.toDomain(row));
    expect(p.valorTotal.toString()).toBe('123.45');
    expect(p.clienteId).toBeNull();
    expect(p.correlationId).toBeNull();
    expect(p).toMatchObject({ id: 'id-1', osId: 'os-1', status: 'REPROVADO' });
  });
});
