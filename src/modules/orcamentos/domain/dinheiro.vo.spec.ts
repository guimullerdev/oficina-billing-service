import { Dinheiro } from './dinheiro.vo';

describe('Dinheiro', () => {
  it('rounds to 2 decimals', () => {
    expect(Dinheiro.create(10.456).getValue()).toBe(10.46);
  });
  it('accepts zero', () => {
    expect(Dinheiro.create(0).getValue()).toBe(0);
  });
  it('rejects negative', () => {
    expect(() => Dinheiro.create(-1)).toThrow('negativo');
  });
  it('rejects non finite', () => {
    expect(() => Dinheiro.create(NaN)).toThrow('finito');
    expect(() => Dinheiro.create(Infinity)).toThrow('finito');
  });
  it('compares by value', () => {
    expect(Dinheiro.create(1.5).equals(Dinheiro.create(1.5))).toBe(true);
    expect(Dinheiro.create(1.5).equals(Dinheiro.create(2))).toBe(false);
  });
});
