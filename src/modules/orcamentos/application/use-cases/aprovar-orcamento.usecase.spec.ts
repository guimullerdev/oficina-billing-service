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
import { AprovarOrcamentoUseCase } from './aprovar-orcamento.usecase';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('AprovarOrcamentoUseCase', () => {
  const tx = { fake: 'tx' } as unknown as Prisma.TransactionClient;
  const repo: jest.Mocked<OrcamentoRepository> = {
    findById: jest.fn(),
    findByOsId: jest.fn(),
    save: jest.fn(),
  };
  const $transaction = jest.fn();
  const prisma = { $transaction } as unknown as PrismaService;
  const outbox = { append: jest.fn() } as unknown as jest.Mocked<OutboxWriter>;
  const useCase = new AprovarOrcamentoUseCase(repo, prisma, outbox);

  const gerado = (correlationId?: string) =>
    Orcamento.create({
      osId: 'os-1',
      clienteId: 'cli-1',
      valorTotal: Dinheiro.create(150.5),
      correlationId,
    });

  beforeEach(() => {
    jest.resetAllMocks();
    $transaction.mockImplementation(
      async (fn: (t: Prisma.TransactionClient) => Promise<unknown>) => fn(tx),
    );
    repo.save.mockResolvedValue(undefined);
    outbox.append.mockResolvedValue(undefined);
  });

  it('approves, saves and writes the event in the same transaction', async () => {
    const orcamento = gerado('corr-1');
    repo.findById.mockResolvedValue(orcamento);

    const result = await useCase.execute(orcamento.id);

    expect(result).not.toBe(orcamento);
    expect(result.status).toBe(StatusOrcamento.APROVADO);
    expect(repo.findById).toHaveBeenCalledWith(orcamento.id);
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalledWith(result, tx);
    expect(outbox.append).toHaveBeenCalledWith(tx, [
      {
        evento: 'orcamento.aprovado',
        aggregateType: 'orcamento',
        aggregateId: orcamento.id,
        payload: {
          osId: 'os-1',
          orcamentoId: orcamento.id,
          valorTotal: 150.5,
          status: 'APROVADO',
        },
        correlationId: 'corr-1',
        traceparent: undefined,
      },
    ]);
  });

  it('payload has exactly the expected keys', async () => {
    const orcamento = gerado('corr-1');
    repo.findById.mockResolvedValue(orcamento);

    await useCase.execute(orcamento.id);

    const [, events] = outbox.append.mock.calls[0];
    expect(Object.keys(events[0].payload).sort()).toEqual(
      ['orcamentoId', 'osId', 'status', 'valorTotal'].sort(),
    );
    expect(typeof events[0].payload.valorTotal).toBe('number');
  });

  it('uses ctx correlationId/traceparent when the orcamento has none', async () => {
    const orcamento = gerado();
    repo.findById.mockResolvedValue(orcamento);

    await useCase.execute(orcamento.id, {
      correlationId: 'ctx-corr',
      traceparent: '00-abc-def-01',
    });

    const [, events] = outbox.append.mock.calls[0];
    expect(events[0].correlationId).toBe('ctx-corr');
    expect(events[0].traceparent).toBe('00-abc-def-01');
  });

  it('generates a correlationId when none is available', async () => {
    const orcamento = gerado();
    repo.findById.mockResolvedValue(orcamento);

    await useCase.execute(orcamento.id);

    const [, events] = outbox.append.mock.calls[0];
    expect(events[0].correlationId).toMatch(UUID_RE);
  });

  it('throws OrcamentoNaoEncontradoError when not found', async () => {
    repo.findById.mockResolvedValue(null);

    await expect(useCase.execute('missing')).rejects.toBeInstanceOf(
      OrcamentoNaoEncontradoError,
    );
    expect($transaction).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('aprovar twice -> OrcamentoTransicaoInvalidaError and nothing written', async () => {
    const aprovado = gerado().aprovar();
    repo.findById.mockResolvedValue(aprovado);

    await expect(useCase.execute(aprovado.id)).rejects.toBeInstanceOf(
      OrcamentoTransicaoInvalidaError,
    );
    expect($transaction).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('propagates transaction failures', async () => {
    const orcamento = gerado();
    repo.findById.mockResolvedValue(orcamento);
    outbox.append.mockRejectedValue(new Error('db down'));

    await expect(useCase.execute(orcamento.id)).rejects.toThrow('db down');
  });
});
