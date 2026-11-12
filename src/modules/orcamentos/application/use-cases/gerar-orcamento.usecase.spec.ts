import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OutboxWriter } from '../../../../shared/messaging/outbox.writer';
import { Dinheiro } from '../../domain/dinheiro.vo';
import {
  Orcamento,
  StatusOrcamento,
  TipoItemOrcamento,
} from '../../domain/orcamento.entity';
import { OrcamentoRepository } from '../../domain/orcamento.repository';
import {
  GerarOrcamentoInput,
  GerarOrcamentoUseCase,
} from './gerar-orcamento.usecase';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('boom', {
    code,
    clientVersion: 'test',
  });

describe('GerarOrcamentoUseCase', () => {
  const tx = { fake: 'tx' } as unknown as Prisma.TransactionClient;
  const repo: jest.Mocked<OrcamentoRepository> = {
    findById: jest.fn(),
    findByOsId: jest.fn(),
    save: jest.fn(),
  };
  const outbox = { append: jest.fn() } as unknown as jest.Mocked<OutboxWriter>;
  const useCase = new GerarOrcamentoUseCase(repo, outbox);
  let warn: jest.SpyInstance;

  const itens = [
    {
      tipo: TipoItemOrcamento.SERVICO,
      refId: 'srv-1',
      descricao: 'Troca de óleo',
      quantidade: 1,
      precoUnitario: 120.5,
    },
    {
      tipo: TipoItemOrcamento.PECA,
      refId: 'peca-1',
      descricao: 'Filtro de óleo',
      quantidade: 2,
      precoUnitario: 35.1,
    },
  ];

  const novo: GerarOrcamentoInput = {
    osId: 'os-1',
    clienteId: 'cli-1',
    itens,
    valorTotal: 190.7,
    correlationId: 'corr-1',
    traceparent: '00-abc-def-01',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    repo.findByOsId.mockResolvedValue(null);
    repo.save.mockResolvedValue(undefined);
    outbox.append.mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('creates GERADO with items and appends orcamento.gerado in the same tx', async () => {
    const result = await useCase.execute(novo, tx);

    expect(repo.findByOsId).toHaveBeenCalledWith('os-1', tx);
    const saved = repo.save.mock.calls[0][0];
    expect(repo.save).toHaveBeenCalledWith(saved, tx);
    expect(saved).toBe(result);
    expect(saved.status).toBe(StatusOrcamento.GERADO);
    expect(saved.osId).toBe('os-1');
    expect(saved.clienteId).toBe('cli-1');
    expect(saved.correlationId).toBe('corr-1');
    expect(saved.valorTotal.getValue()).toBe(190.7);
    expect(saved.itens).toHaveLength(2);
    expect(saved.itens[1]).toMatchObject({
      tipo: TipoItemOrcamento.PECA,
      refId: 'peca-1',
      descricao: 'Filtro de óleo',
      quantidade: 2,
    });
    expect(saved.itens[1].precoUnitario.getValue()).toBe(35.1);

    expect(outbox.append).toHaveBeenCalledTimes(1);
    expect(outbox.append).toHaveBeenCalledWith(tx, [
      {
        evento: 'orcamento.gerado',
        aggregateType: 'orcamento',
        aggregateId: saved.id,
        payload: {
          osId: 'os-1',
          orcamentoId: saved.id,
          valorTotal: 190.7,
          status: 'GERADO',
        },
        correlationId: 'corr-1',
        traceparent: '00-abc-def-01',
      },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('sums the items when valorTotal is missing', async () => {
    await useCase.execute({ ...novo, valorTotal: undefined }, tx);
    expect(repo.save.mock.calls[0][0].valorTotal.getValue()).toBe(190.7);
    expect(outbox.append.mock.calls[0][1][0].payload).toMatchObject({
      valorTotal: 190.7,
    });
  });

  it('uses valorTotal 0 and warns when itens are missing (D-BIL-1)', async () => {
    const result = await useCase.execute(
      { osId: 'os-old', correlationId: 'corr-2' },
      tx,
    );
    expect(result?.valorTotal.getValue()).toBe(0);
    expect(result?.itens).toEqual([]);
    expect(result?.clienteId).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('osId=os-old'));
    expect(outbox.append.mock.calls[0][1][0]).toMatchObject({
      payload: { osId: 'os-old', valorTotal: 0, status: 'GERADO' },
      correlationId: 'corr-2',
      traceparent: undefined,
    });
  });

  it('ignores a payload valorTotal when itens are missing', async () => {
    const result = await useCase.execute({ osId: 'os-x', valorTotal: 99 }, tx);
    expect(result?.valorTotal.getValue()).toBe(0);
  });

  it('generates one correlationId shared by orcamento and event when absent', async () => {
    const result = await useCase.execute(
      { ...novo, correlationId: undefined },
      tx,
    );
    expect(result?.correlationId).toMatch(UUID_RE);
    expect(outbox.append.mock.calls[0][1][0].correlationId).toBe(
      result?.correlationId,
    );
  });

  it('is a no-op returning the existing orcamento when one exists for osId', async () => {
    const existente = Orcamento.create({
      osId: 'os-1',
      valorTotal: Dinheiro.create(10),
    });
    repo.findByOsId.mockResolvedValueOnce(existente);

    await expect(useCase.execute(novo, tx)).resolves.toBe(existente);
    expect(repo.save).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('treats a unique violation (P2002 race on os_id) as already exists', async () => {
    repo.save.mockRejectedValueOnce(prismaError('P2002'));

    await expect(useCase.execute(novo, tx)).resolves.toBeNull();
    expect(outbox.append).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('osId=os-1'));
  });

  it('rethrows other persistence errors', async () => {
    const err = prismaError('P2025');
    repo.save.mockRejectedValueOnce(err);
    await expect(useCase.execute(novo, tx)).rejects.toBe(err);
    expect(outbox.append).not.toHaveBeenCalled();
  });
});
