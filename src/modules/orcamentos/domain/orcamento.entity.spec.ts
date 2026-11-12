import { Dinheiro } from './dinheiro.vo';
import {
  Orcamento,
  OrcamentoTransicaoInvalidaError,
  StatusOrcamento,
  TipoItemOrcamento,
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

  describe('itens', () => {
    const item = {
      tipo: TipoItemOrcamento.SERVICO,
      refId: 'srv-1',
      descricao: 'Troca de óleo',
      quantidade: 2,
      precoUnitario: Dinheiro.create(50),
    };

    it('defaults to an empty list', () => {
      expect(novo().itens).toEqual([]);
    });

    it('creates items with ids as an immutable snapshot', () => {
      const input = [item];
      const o = Orcamento.create({
        osId: 'os-1',
        valorTotal: Dinheiro.create(100),
        itens: input,
      });
      expect(o.itens).toHaveLength(1);
      expect(o.itens[0]).toMatchObject({ refId: 'srv-1', quantidade: 2 });
      expect(o.itens[0].id).toMatch(/^[0-9a-f-]{36}$/);
      input.push({ ...item, refId: 'srv-2' });
      expect(o.itens).toHaveLength(1);
      expect(Object.isFrozen(o.itens)).toBe(true);
      expect(Object.isFrozen(o.itens[0])).toBe(true);
    });

    it('keeps items across transitions and restore', () => {
      const o = Orcamento.create({
        osId: 'os-1',
        valorTotal: Dinheiro.create(100),
        itens: [item],
      });
      expect(o.aprovar().itens).toEqual(o.itens);
      expect(o.reprovar('x').itens).toEqual(o.itens);
      const r = Orcamento.restore({
        id: o.id,
        osId: o.osId,
        status: StatusOrcamento.GERADO,
        valorTotal: o.valorTotal,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        itens: [{ ...item, id: 'it-1' }],
      });
      expect(r.itens[0].id).toBe('it-1');
    });

    it.each([0, -1, 1.5])('rejects quantidade %p', (quantidade) => {
      expect(() =>
        Orcamento.create({
          osId: 'os-1',
          valorTotal: Dinheiro.create(0),
          itens: [{ ...item, quantidade }],
        }),
      ).toThrow('Quantidade');
    });
  });
});
