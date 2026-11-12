export class CobrancaNaoEncontradaError extends Error {
  constructor(criterio: string) {
    super(`Cobrança não encontrada (${criterio})`);
    this.name = 'CobrancaNaoEncontradaError';
  }
}
