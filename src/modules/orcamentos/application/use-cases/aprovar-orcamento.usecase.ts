import { PrismaService } from '../../../../prisma/prisma.service';
import { OutboxWriter } from '../../../../shared/messaging/outbox.writer';
import { Orcamento } from '../../domain/orcamento.entity';
import { OrcamentoRepository } from '../../domain/orcamento.repository';
import { OrcamentoNaoEncontradoError } from '../errors/orcamento-nao-encontrado.error';
import { buildOrcamentoEvent, EventContext } from '../events/orcamento-events';

export class AprovarOrcamentoUseCase {
  constructor(
    private readonly repo: OrcamentoRepository,
    private readonly prisma: PrismaService,
    private readonly outboxWriter: OutboxWriter,
  ) {}

  async execute(id: string, ctx?: EventContext): Promise<Orcamento> {
    const orcamento = await this.repo.findById(id);
    if (!orcamento) throw new OrcamentoNaoEncontradoError(`id=${id}`);

    const updated = orcamento.aprovar();
    const event = buildOrcamentoEvent('orcamento.aprovado', updated, {}, ctx);

    await this.prisma.$transaction(async (tx) => {
      await this.repo.save(updated, tx);
      await this.outboxWriter.append(tx, [event]);
    });

    return updated;
  }
}
