import { Orcamento } from '../../domain/orcamento.entity';
import { OrcamentoRepository } from '../../domain/orcamento.repository';
import { OrcamentoNaoEncontradoError } from '../errors/orcamento-nao-encontrado.error';

export class GetOrcamentoByOsUseCase {
  constructor(private readonly repo: OrcamentoRepository) {}

  async execute(osId: string): Promise<Orcamento> {
    const orcamento = await this.repo.findByOsId(osId);
    if (!orcamento) throw new OrcamentoNaoEncontradoError(`osId=${osId}`);
    return orcamento;
  }
}
