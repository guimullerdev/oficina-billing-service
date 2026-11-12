import { Cobranca, StatusCobranca } from './cobranca.entity';

describe('Cobranca', () => {
  it('creates a PENDENTE cobranca with the gateway payment', () => {
    const c = Cobranca.pendente({
      osId: 'os-1',
      orcamentoId: 'orc-1',
      valor: 10.005,
      gatewayPaymentId: 'pay-1',
      checkoutUrl: 'http://x',
      correlationId: 'corr-1',
      sagaId: 'saga-1',
    });

    expect(c.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(c.status).toBe(StatusCobranca.PENDENTE);
    expect(c.osId).toBe('os-1');
    expect(c.orcamentoId).toBe('orc-1');
    expect(c.valor).toBe(10.01);
    expect(c.gatewayPaymentId).toBe('pay-1');
    expect(c.checkoutUrl).toBe('http://x');
    expect(c.correlationId).toBe('corr-1');
    expect(c.sagaId).toBe('saga-1');
    expect(c.motivo).toBeUndefined();
    expect(c.createdAt).toEqual(c.updatedAt);
  });

  it('creates a RECUSADA cobranca with motivo and no payment', () => {
    const c = Cobranca.recusada({
      osId: 'os-1',
      valor: 0,
      motivo: 'orcamento_inexistente',
    });

    expect(c.status).toBe(StatusCobranca.RECUSADA);
    expect(c.motivo).toBe('orcamento_inexistente');
    expect(c.orcamentoId).toBeUndefined();
    expect(c.gatewayPaymentId).toBeUndefined();
    expect(c.checkoutUrl).toBeUndefined();
  });

  it('rejects an invalid valor', () => {
    expect(() =>
      Cobranca.recusada({ osId: 'os-1', valor: -1, motivo: 'x' }),
    ).toThrow();
    expect(() =>
      Cobranca.recusada({ osId: 'os-1', valor: Number.NaN, motivo: 'x' }),
    ).toThrow();
  });

  it('restores from props', () => {
    const date = new Date('2026-01-01T00:00:00Z');
    const c = Cobranca.restore({
      id: 'id-1',
      osId: 'os-1',
      valor: 5,
      status: StatusCobranca.CONFIRMADA,
      createdAt: date,
      updatedAt: date,
    });

    expect(c.id).toBe('id-1');
    expect(c.status).toBe(StatusCobranca.CONFIRMADA);
    expect(c.createdAt).toBe(date);
  });
});
