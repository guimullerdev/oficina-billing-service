export class OrcamentoNaoEncontradoError extends Error {
  constructor(criterio: string) {
    super(`Orçamento não encontrado (${criterio})`);
    this.name = 'OrcamentoNaoEncontradoError';
  }
}
