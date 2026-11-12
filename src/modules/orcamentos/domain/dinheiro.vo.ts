export class Dinheiro {
  private constructor(private readonly value: number) {}

  static create(valor: number): Dinheiro {
    if (!Number.isFinite(valor)) {
      throw new Error('Valor monetário deve ser um número finito');
    }
    if (valor < 0) {
      throw new Error('Valor monetário não pode ser negativo');
    }
    return new Dinheiro(Math.round(valor * 100) / 100);
  }

  getValue(): number {
    return this.value;
  }

  equals(other: Dinheiro): boolean {
    return this.value === other.value;
  }
}
