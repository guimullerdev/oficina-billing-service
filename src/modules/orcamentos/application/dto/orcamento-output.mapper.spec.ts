import { Dinheiro } from '../../domain/dinheiro.vo';
import { Orcamento, StatusOrcamento } from '../../domain/orcamento.entity';
import { toOrcamentoOutput } from './orcamento-output.mapper';

describe('toOrcamentoOutput', () => {
  const createdAt = new Date('2026-01-01T00:00:00Z');
  const updatedAt = new Date('2026-01-02T00:00:00Z');

  it('maps all fields with valorTotal as number', () => {
    const orcamento = Orcamento.restore({
      id: 'orc-1',
      osId: 'os-1',
      clienteId: 'cli-1',
      status: StatusOrcamento.REPROVADO,
      valorTotal: Dinheiro.create(12.34),
      motivoReprovacao: 'caro',
      correlationId: 'corr-1',
      createdAt,
      updatedAt,
    });

    expect(toOrcamentoOutput(orcamento)).toEqual({
      id: 'orc-1',
      osId: 'os-1',
      clienteId: 'cli-1',
      status: 'REPROVADO',
      valorTotal: 12.34,
      motivoReprovacao: 'caro',
      createdAt,
      updatedAt,
    });
  });

  it('maps optional fields to null', () => {
    const orcamento = Orcamento.restore({
      id: 'orc-2',
      osId: 'os-2',
      status: StatusOrcamento.GERADO,
      valorTotal: Dinheiro.create(0),
      createdAt,
      updatedAt,
    });

    const out = toOrcamentoOutput(orcamento);
    expect(out.clienteId).toBeNull();
    expect(out.motivoReprovacao).toBeNull();
  });
});
