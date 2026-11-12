import { readFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { IncomingMessage } from '../../../../shared/messaging/handlers/message-handler.interface';
import { OutboxWriter } from '../../../../shared/messaging/outbox.writer';
import { TipoItemOrcamento } from '../../domain/orcamento.entity';
import { OrcamentoRepository } from '../../domain/orcamento.repository';
import { GerarOrcamentoUseCase } from '../use-cases/gerar-orcamento.usecase';
import {
  DiagnosticoConcluidoHandler,
  DiagnosticoConcluidoPayloadInvalidoError,
  parseDiagnosticoConcluido,
} from './diagnostico-concluido.handler';

const fixture = (shape: 'old' | 'new'): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      join(__dirname, '__fixtures__', `diagnostico-concluido.${shape}.json`),
      'utf8',
    ),
  ) as Record<string, unknown>;

const message = (payload: unknown): IncomingMessage => ({
  messageId: 'm-1',
  eventId: 'ev-1',
  evento: 'diagnostico.concluido',
  payload,
  correlationId: 'corr-1',
  traceparent: '00-trace-span-01',
});

const tx = { fake: 'tx' } as unknown as Prisma.TransactionClient;

describe('parseDiagnosticoConcluido', () => {
  it('parses the new (rich) shape', () => {
    const payload = fixture('new');
    expect(parseDiagnosticoConcluido(payload)).toEqual({
      osId: payload.osId,
      clienteId: payload.clienteId,
      valorTotal: 190.7,
      itens: [
        {
          tipo: TipoItemOrcamento.SERVICO,
          refId: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
          descricao: 'Troca de óleo',
          quantidade: 1,
          precoUnitario: 120.5,
        },
        {
          tipo: TipoItemOrcamento.PECA,
          refId: '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a',
          descricao: 'Filtro de óleo',
          quantidade: 2,
          precoUnitario: 35.1,
        },
      ],
    });
  });

  it('parses the old shape using id as osId', () => {
    const payload = fixture('old');
    expect(parseDiagnosticoConcluido(payload)).toEqual({
      osId: payload.id,
      clienteId: undefined,
      itens: undefined,
      valorTotal: undefined,
    });
  });

  it('prefers osId over id and accepts null optional fields', () => {
    expect(
      parseDiagnosticoConcluido({
        id: 'a',
        osId: 'b',
        clienteId: null,
        itens: null,
        valorTotal: null,
      }),
    ).toEqual({
      osId: 'b',
      clienteId: undefined,
      itens: undefined,
      valorTotal: undefined,
    });
  });

  const item = {
    tipo: 'PECA',
    refId: 'p-1',
    descricao: 'Filtro',
    quantidade: 1,
    precoUnitario: 10,
  };

  it.each<[string, unknown]>([
    ['null payload', null],
    ['array payload', []],
    ['string payload', 'x'],
    ['missing osId and id', { status: 'X' }],
    ['blank osId', { osId: '  ' }],
    ['non-string osId', { osId: 123 }],
    ['non-string clienteId', { osId: 'o', clienteId: 1 }],
    ['blank clienteId', { osId: 'o', clienteId: '' }],
    ['itens not an array', { osId: 'o', itens: {} }],
    ['item not an object', { osId: 'o', itens: [null] }],
    ['invalid tipo', { osId: 'o', itens: [{ ...item, tipo: 'OUTRO' }] }],
    ['blank refId', { osId: 'o', itens: [{ ...item, refId: ' ' }] }],
    ['non-string descricao', { osId: 'o', itens: [{ ...item, descricao: 1 }] }],
    ['zero quantidade', { osId: 'o', itens: [{ ...item, quantidade: 0 }] }],
    [
      'fractional quantidade',
      { osId: 'o', itens: [{ ...item, quantidade: 1.5 }] },
    ],
    [
      'string precoUnitario',
      { osId: 'o', itens: [{ ...item, precoUnitario: '10' }] },
    ],
    [
      'negative precoUnitario',
      { osId: 'o', itens: [{ ...item, precoUnitario: -1 }] },
    ],
    ['NaN valorTotal', { osId: 'o', itens: [item], valorTotal: Number.NaN }],
    ['negative valorTotal', { osId: 'o', itens: [item], valorTotal: -5 }],
    ['string valorTotal', { osId: 'o', itens: [item], valorTotal: '10' }],
  ])('rejects %s', (_label, payload) => {
    expect(() => parseDiagnosticoConcluido(payload)).toThrow(
      DiagnosticoConcluidoPayloadInvalidoError,
    );
  });
});

describe('DiagnosticoConcluidoHandler', () => {
  const execute = jest.fn();
  const gerar = { execute } as unknown as GerarOrcamentoUseCase;
  const handler = new DiagnosticoConcluidoHandler(gerar);

  beforeEach(() => jest.resetAllMocks());

  it('handles diagnostico.concluido', () => {
    expect(handler.evento).toBe('diagnostico.concluido');
  });

  it('calls the use case with parsed payload, message context and tx', async () => {
    execute.mockResolvedValue(null);
    await handler.handle(message(fixture('old')), tx);
    expect(execute).toHaveBeenCalledWith(
      {
        osId: '6b1f0c1e-3a52-4c1d-9f0e-2d7a8b9c0d11',
        clienteId: undefined,
        itens: undefined,
        valorTotal: undefined,
        correlationId: 'corr-1',
        traceparent: '00-trace-span-01',
      },
      tx,
    );
  });

  it('rejects invalid payloads without calling the use case', async () => {
    await expect(handler.handle(message({ foo: 1 }), tx)).rejects.toThrow(
      DiagnosticoConcluidoPayloadInvalidoError,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('requires the transaction from the idempotent processor', async () => {
    await expect(handler.handle(message(fixture('new')))).rejects.toThrow(
      'transação',
    );
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('DiagnosticoConcluidoHandler + GerarOrcamentoUseCase (fixtures)', () => {
  const repo: jest.Mocked<OrcamentoRepository> = {
    findById: jest.fn(),
    findByOsId: jest.fn(),
    save: jest.fn(),
  };
  const outbox = { append: jest.fn() } as unknown as jest.Mocked<OutboxWriter>;
  const handler = new DiagnosticoConcluidoHandler(
    new GerarOrcamentoUseCase(repo, outbox),
  );
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    repo.findByOsId.mockResolvedValue(null);
  });

  afterEach(() => jest.restoreAllMocks());

  it('new shape: persists items with the payload total and emits orcamento.gerado', async () => {
    const payload = fixture('new');
    await handler.handle(message(payload), tx);

    const saved = repo.save.mock.calls[0][0];
    expect(repo.save.mock.calls[0][1]).toBe(tx);
    expect(saved.itens.map((i) => i.refId)).toEqual([
      '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
      '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a',
    ]);
    expect(saved.clienteId).toBe(payload.clienteId);
    expect(outbox.append).toHaveBeenCalledWith(tx, [
      expect.objectContaining({
        evento: 'orcamento.gerado',
        payload: {
          osId: payload.osId,
          orcamentoId: saved.id,
          valorTotal: 190.7,
          status: 'GERADO',
        },
        correlationId: 'corr-1',
        traceparent: '00-trace-span-01',
      }),
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('old shape: valorTotal 0 and a D-BIL-1 warning', async () => {
    await handler.handle(message(fixture('old')), tx);

    const saved = repo.save.mock.calls[0][0];
    expect(saved.osId).toBe('6b1f0c1e-3a52-4c1d-9f0e-2d7a8b9c0d11');
    expect(saved.valorTotal.getValue()).toBe(0);
    expect(saved.itens).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('osId=6b1f0c1e-3a52-4c1d-9f0e-2d7a8b9c0d11'),
    );
    expect(outbox.append.mock.calls[0][1][0].payload).toMatchObject({
      valorTotal: 0,
      status: 'GERADO',
    });
  });
});
