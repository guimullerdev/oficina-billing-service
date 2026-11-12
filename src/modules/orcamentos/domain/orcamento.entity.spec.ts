import { Dinheiro } from './dinheiro.vo';
import {
  Orcamento,
  OrcamentoTransicaoInvalidaError,
  StatusOrcamento,
} from './orcamento.entity';

const novo = () =>
  Orcamento.create({
    osId: 'os-1',
    clienteId: 'cli-1',
    valorTotal: Dinheiro.create(100),
    correlationId: 'corr-1',
  });

describe('Orcamento', () => {
  it('creates in GERADO', () => {
    const o = novo();
    expect(o.status).toBe(StatusOrcamento.GERADO);
    expect(o.id).toBeDefined();
    expect(o.osId).toBe('os-1');
    expect(o.clienteId).toBe('cli-1');
    expect(o.correlationId).toBe('corr-1');
    expect(o.valorTotal.getValue()).toBe(100);
    expect(o.motivoReprovacao).toBeUndefined();
    expect(o.createdAt).toBeInstanceOf(Date);
    expect(o.updatedAt).toBeInstanceOf(Date);
  });

  it('restores from props', () => {
    const o = novo();
    const r = Orcamento.restore({
      id: o.id,
      osId: o.osId,
      status: StatusOrcamento.APROVADO,
      valorTotal: o.valorTotal,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    });
    expect(r.status).toBe(StatusOrcamento.APROVADO);
    expect(r.id).toBe(o.id);
  });

  it('approves from GERADO', () => {
    const o = novo();
    const a = o.aprovar();
    expect(a.status).toBe(StatusOrcamento.APROVADO);
    expect(o.status).toBe(StatusOrcamento.GERADO);
  });

  it('rejects from GERADO with motivo', () => {
    const r = novo().reprovar('  caro demais ');
    expect(r.status).toBe(StatusOrcamento.REPROVADO);
    expect(r.motivoReprovacao).toBe('caro demais');
  });

  it.each(['', '   '])('requires non-empty motivo (%j)', (m) => {
    expect(() => novo().reprovar(m)).toThrow('obrigatório');
  });

  it('blocks transitions from non-GERADO', () => {
    const a = novo().aprovar();
    const r = novo().reprovar('x');
    expect(() => a.aprovar()).toThrow(OrcamentoTransicaoInvalidaError);
    expect(() => a.reprovar('x')).toThrow(OrcamentoTransicaoInvalidaError);
    expect(() => r.aprovar()).toThrow(OrcamentoTransicaoInvalidaError);
    expect(() => r.reprovar('y')).toThrow(OrcamentoTransicaoInvalidaError);
  });
});
