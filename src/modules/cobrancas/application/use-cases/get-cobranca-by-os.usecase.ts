import { Cobranca } from '../../domain/cobranca.entity';
import { CobrancaRepository } from '../../domain/cobranca.repository';
import { CobrancaNaoEncontradaError } from '../errors/cobranca-nao-encontrada.error';

export class GetCobrancaByOsUseCase {
  constructor(private readonly repo: CobrancaRepository) {}

  async execute(osId: string): Promise<Cobranca> {
    const cobranca = await this.repo.findByOsId(osId);
    if (!cobranca) throw new CobrancaNaoEncontradaError(`osId=${osId}`);
    return cobranca;
  }
}
