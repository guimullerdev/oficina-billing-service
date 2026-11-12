import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { OutboxWriter } from '../../../../shared/messaging/outbox.writer';
import { Dinheiro } from '../../domain/dinheiro.vo';
import {
  Orcamento,
  OrcamentoTransicaoInvalidaError,
  StatusOrcamento,
} from '../../domain/orcamento.entity';
import { OrcamentoRepository } from '../../domain/orcamento.repository';
import { OrcamentoNaoEncontradoError } from '../errors/orcamento-nao-encontrado.error';
import { ReprovarOrcamentoUseCase } from './reprovar-orcamento.usecase';

describe('ReprovarOrcamentoUseCase', () => {
  const tx = { fake: 'tx' } as unknown as Prisma.TransactionClient;
  const repo: jest.Mocked<OrcamentoRepository> = {
    findById: jest.fn(),
    findByOsId: jest.fn(),
    save: jest.fn(),
  };
  const $transaction = jest.fn();
  const prisma = { $transaction } as unknown as PrismaService;
  const outbox = { append: jest.fn() } as unknown as jest.Mocked<OutboxWriter>;
  const useCase = new ReprovarOrcamentoUseCase(repo, prisma, outbox);

  const gerado = (correlationId?: string) =>
    Orcamento.create({
      osId: 'os-1',
      valorTotal: Dinheiro.create(99.9),
      correlationId,
    });

  const expectNothingWritten = () => {
    expect($transaction).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  };

  beforeEach(() => {
    jest.resetAllMocks();
    $transaction.mockImplementation(
      async (fn: (t: Prisma.TransactionClient) => Promise<unknown>) => fn(tx),
    );
    repo.save.mockResolvedValue(undefined);
    outbox.append.mockResolvedValue(undefined);
  });

  it('reprova, saves and writes the event in the same transaction', async () => {
    const orcamento = gerado('corr-9');
    repo.findById.mockResolvedValue(orcamento);

    const result = await useCase.execute(orcamento.id, '  caro demais ', {
      traceparent: '00-t-p-01',
    });

    expect(result.status).toBe(StatusOrcamento.REPROVADO);
    expect(result.motivoReprovacao).toBe('caro demais');
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalledWith(result, tx);
    expect(outbox.append).toHaveBeenCalledWith(tx, [
      {
        evento: 'orcamento.reprovado',
        aggregateType: 'orcamento',
        aggregateId: orcamento.id,
        payload: {
          osId: 'os-1',
          orcamentoId: orcamento.id,
          valorTotal: 99.9,
          status: 'REPROVADO',
          motivo: 'caro demais',
        },
        correlationId: 'corr-9',
        traceparent: '00-t-p-01',
      },
    ]);
    const [, events] = outbox.append.mock.calls[0];
    expect(Object.keys(events[0].payload).sort()).toEqual(
      ['motivo', 'orcamentoId', 'osId', 'status', 'valorTotal'].sort(),
    );
  });

  it('throws OrcamentoNaoEncontradoError when not found', async () => {
    repo.findById.mockResolvedValue(null);

    await expect(useCase.execute('missing', 'x')).rejects.toBeInstanceOf(
      OrcamentoNaoEncontradoError,
    );
    expectNothingWritten();
  });

  it('rejects an empty motivo and writes nothing', async () => {
    const orcamento = gerado();
    repo.findById.mockResolvedValue(orcamento);

    await expect(useCase.execute(orcamento.id, '   ')).rejects.toThrow(
      'Motivo da reprovação é obrigatório',
    );
    expectNothingWritten();
  });

  it('rejects reprovar on an already approved orcamento and writes nothing', async () => {
    const aprovado = gerado().aprovar();
    repo.findById.mockResolvedValue(aprovado);

    await expect(useCase.execute(aprovado.id, 'motivo')).rejects.toBeInstanceOf(
      OrcamentoTransicaoInvalidaError,
    );
    expectNothingWritten();
  });
});
