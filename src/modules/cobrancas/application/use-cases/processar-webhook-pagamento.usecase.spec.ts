import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../../prisma/prisma.service';
import { OutboxWriter } from '../../../../shared/messaging/outbox.writer';
import { Cobranca, StatusCobranca } from '../../domain/cobranca.entity';
import { CobrancaRepository } from '../../domain/cobranca.repository';
import { CobrancaNaoEncontradaError } from '../errors/cobranca-nao-encontrada.error';
import {
  GatewayPaymentStatus,
  PaymentGateway,
  PaymentGatewayUnavailableError,
} from '../ports/payment-gateway.port';
import { ProcessarWebhookPagamentoUseCase } from './processar-webhook-pagamento.usecase';

const ID = '22222222-2222-4222-8222-222222222222';
const OS_ID = '11111111-1111-4111-8111-111111111111';
const ORC_ID = '33333333-3333-4333-8333-333333333333';
const PAY_ID = '44444444-4444-4444-8444-444444444444';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cobranca = (
  status = StatusCobranca.PENDENTE,
  correlationId: string | null = 'corr-saga',
) =>
  Cobranca.restore({
    id: ID,
    osId: OS_ID,
    orcamentoId: ORC_ID,
    gatewayPaymentId: PAY_ID,
    valor: 150.5,
    status,
    checkoutUrl: `http://localhost:3000/gateway/checkout/${PAY_ID}`,
    correlationId: correlationId ?? undefined,
    sagaId: 'saga-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

const pagamento = (status: GatewayPaymentStatus) => ({
  id: PAY_ID,
  status,
  amountCents: 15050,
  currency: 'BRL',
  checkoutUrl: `http://localhost:3000/gateway/checkout/${PAY_ID}`,
  metadata: null,
});

describe('ProcessarWebhookPagamentoUseCase', () => {
  const updateMany = jest.fn();
  const tx = {
    cobranca: { updateMany },
  } as unknown as Prisma.TransactionClient;
  const $transaction = jest.fn();
  const prisma = { $transaction } as unknown as PrismaService;
  const cobrancas = {
    findByOsId: jest.fn(),
    findByGatewayPaymentId: jest.fn(),
    save: jest.fn(),
  } satisfies jest.Mocked<CobrancaRepository>;
  const gateway = {
    criarPagamento: jest.fn(),
    consultarPagamento: jest.fn(),
  } satisfies jest.Mocked<PaymentGateway>;
  const outbox = { append: jest.fn() } satisfies jest.Mocked<OutboxWriter>;
  const useCase = new ProcessarWebhookPagamentoUseCase(
    cobrancas,
    gateway,
    prisma,
    outbox,
  );
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    $transaction.mockImplementation(
      async (fn: (t: Prisma.TransactionClient) => Promise<unknown>) => fn(tx),
    );
    updateMany.mockResolvedValue({ count: 1 });
    outbox.append.mockResolvedValue(undefined);
    cobrancas.findByGatewayPaymentId.mockResolvedValue(cobranca());
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('throws CobrancaNaoEncontradaError for an unknown payment without calling the gateway', async () => {
    cobrancas.findByGatewayPaymentId.mockResolvedValue(null);

    await expect(useCase.execute(PAY_ID, 'approved')).rejects.toBeInstanceOf(
      CobrancaNaoEncontradaError,
    );
    expect(cobrancas.findByGatewayPaymentId).toHaveBeenCalledWith(PAY_ID);
    expect(gateway.consultarPagamento).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it('approved: confirms the cobranca and appends pagamento.confirmado in the same transaction', async () => {
    gateway.consultarPagamento.mockResolvedValue(pagamento('approved'));

    const result = await useCase.execute(PAY_ID, 'approved');

    expect(result).toEqual({ status: StatusCobranca.CONFIRMADA });
    expect(gateway.consultarPagamento).toHaveBeenCalledWith(PAY_ID);
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: ID, status: StatusCobranca.PENDENTE },
      data: { status: StatusCobranca.CONFIRMADA },
    });
    expect(outbox.append).toHaveBeenCalledWith(tx, [
      {
        evento: 'pagamento.confirmado',
        aggregateType: 'cobranca',
        aggregateId: ID,
        payload: {
          osId: OS_ID,
          cobrancaId: ID,
          valor: 150.5,
          status: 'CONFIRMADA',
        },
        correlationId: 'corr-saga',
      },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('declined: refuses the cobranca and appends pagamento.recusado with motivo', async () => {
    gateway.consultarPagamento.mockResolvedValue(pagamento('declined'));

    const result = await useCase.execute(PAY_ID, 'declined');

    expect(result).toEqual({ status: StatusCobranca.RECUSADA });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: ID, status: StatusCobranca.PENDENTE },
      data: { status: StatusCobranca.RECUSADA, motivo: 'pagamento_recusado' },
    });
    expect(outbox.append).toHaveBeenCalledWith(tx, [
      {
        evento: 'pagamento.recusado',
        aggregateType: 'cobranca',
        aggregateId: ID,
        payload: {
          osId: OS_ID,
          cobrancaId: ID,
          valor: 150.5,
          status: 'RECUSADA',
          motivo: 'pagamento_recusado',
        },
        correlationId: 'corr-saga',
      },
    ]);
  });

  it('trusts the gateway over the webhook body and warns about the divergence', async () => {
    gateway.consultarPagamento.mockResolvedValue(pagamento('approved'));

    const result = await useCase.execute(PAY_ID, 'declined');

    expect(result).toEqual({ status: StatusCobranca.CONFIRMADA });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('diverge'));
    const [[, events]] = outbox.append.mock.calls;
    expect(events[0].evento).toBe('pagamento.confirmado');
  });

  it('does not warn when the webhook body carries no status', async () => {
    gateway.consultarPagamento.mockResolvedValue(pagamento('approved'));

    await useCase.execute(PAY_ID);

    expect(warn).not.toHaveBeenCalled();
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it('pending: is a no-op', async () => {
    gateway.consultarPagamento.mockResolvedValue(pagamento('pending'));

    const result = await useCase.execute(PAY_ID, 'pending');

    expect(result).toEqual({ status: StatusCobranca.PENDENTE });
    expect($transaction).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it.each([StatusCobranca.CONFIRMADA, StatusCobranca.RECUSADA])(
    'already %s: is a no-op without querying the gateway or writing an event',
    async (status) => {
      cobrancas.findByGatewayPaymentId.mockResolvedValue(cobranca(status));

      const result = await useCase.execute(PAY_ID, 'approved');

      expect(result).toEqual({ status });
      expect(gateway.consultarPagamento).not.toHaveBeenCalled();
      expect($transaction).not.toHaveBeenCalled();
      expect(outbox.append).not.toHaveBeenCalled();
    },
  );

  it('lost race (updateMany count 0): writes no event', async () => {
    gateway.consultarPagamento.mockResolvedValue(pagamento('approved'));
    updateMany.mockResolvedValue({ count: 0 });

    const result = await useCase.execute(PAY_ID, 'approved');

    expect(result).toEqual({ status: StatusCobranca.CONFIRMADA });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('falls back to a random correlationId when the cobranca has none', async () => {
    cobrancas.findByGatewayPaymentId.mockResolvedValue(
      cobranca(StatusCobranca.PENDENTE, null),
    );
    gateway.consultarPagamento.mockResolvedValue(pagamento('approved'));

    await useCase.execute(PAY_ID, 'approved');

    const [[, events]] = outbox.append.mock.calls;
    expect(events[0].correlationId).toMatch(UUID_RE);
  });

  it('propagates gateway unavailability without touching the database', async () => {
    gateway.consultarPagamento.mockRejectedValue(
      new PaymentGatewayUnavailableError('down', 503),
    );

    await expect(useCase.execute(PAY_ID, 'approved')).rejects.toBeInstanceOf(
      PaymentGatewayUnavailableError,
    );
    expect($transaction).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });
});
