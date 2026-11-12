import { Orcamento } from '../../domain/orcamento.entity';
import { OrcamentoRepository } from '../../domain/orcamento.repository';
import { OrcamentoNaoEncontradoError } from '../errors/orcamento-nao-encontrado.error';

export class GetOrcamentoUseCase {
  constructor(private readonly repo: OrcamentoRepository) {}

  async execute(id: string): Promise<Orcamento> {
    const orcamento = await this.repo.findById(id);
    if (!orcamento) throw new OrcamentoNaoEncontradoError(`id=${id}`);
    return orcamento;
  }
}
