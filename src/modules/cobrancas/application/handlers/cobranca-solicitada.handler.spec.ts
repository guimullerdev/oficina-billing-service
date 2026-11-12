import { Prisma } from '@prisma/client';

import { IncomingMessage } from '../../../../shared/messaging/handlers/message-handler.interface';
import { OutboxWriter } from '../../../../shared/messaging/outbox.writer';
import { Dinheiro } from '../../../orcamentos/domain/dinheiro.vo';
import {
  Orcamento,
  StatusOrcamento,
} from '../../../orcamentos/domain/orcamento.entity';
import { OrcamentoRepository } from '../../../orcamentos/domain/orcamento.repository';
import { Cobranca, StatusCobranca } from '../../domain/cobranca.entity';
import { CobrancaRepository } from '../../domain/cobranca.repository';
import {
  PaymentGateway,
  PaymentGatewayConflictError,
  PaymentGatewayUnavailableError,
} from '../ports/payment-gateway.port';
import { SolicitarCobrancaUseCase } from '../use-cases/solicitar-cobranca.usecase';
import {
  COBRANCA_SOLICITADA,
  CobrancaSolicitadaHandler,
  CobrancaSolicitadaPayloadInvalidoError,
} from './cobranca-solicitada.handler';

const OS_ID = '11111111-1111-4111-8111-111111111111';
const SAGA_ID = '22222222-2222-4222-8222-222222222222';
const ORC_ID = '33333333-3333-4333-8333-333333333333';
const tx = { tag: 'tx' } as unknown as Prisma.TransactionClient;

const message = (payload: unknown = {}): IncomingMessage => ({
  messageId: 'm-1',
  eventId: 'e-1',
  evento: COBRANCA_SOLICITADA,
  correlationId: 'corr-1',
  traceparent: '00-abc-def-01',
  payload: {
    id: OS_ID,
    sagaId: SAGA_ID,
    ordem: 4,
    nome: 'COBRAR',
    causadoPor: 'u-1',
    ...(payload as object),
  },
});

const orcamento = (status = StatusOrcamento.APROVADO, valor = 150.5) =>
  Orcamento.restore({
    id: ORC_ID,
    osId: OS_ID,
    status,
    valorTotal: Dinheiro.create(valor),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'x',
  });

describe('CobrancaSolicitadaHandler', () => {
  const cobrancas = {
    findByOsId: jest.fn(),
    findByGatewayPaymentId: jest.fn(),
    save: jest.fn(),
  } satisfies jest.Mocked<CobrancaRepository>;
  const orcamentos = {
    findById: jest.fn(),
    findByOsId: jest.fn(),
    save: jest.fn(),
  } satisfies jest.Mocked<OrcamentoRepository>;
  const gateway = {
    criarPagamento: jest.fn(),
    consultarPagamento: jest.fn(),
  } satisfies jest.Mocked<PaymentGateway>;
  const outbox = { append: jest.fn() } satisfies jest.Mocked<OutboxWriter>;
  const handler = new CobrancaSolicitadaHandler(
    new SolicitarCobrancaUseCase(cobrancas, orcamentos, gateway, outbox),
  );

  const savedCobranca = (): Cobranca =>
    cobrancas.save.mock.calls[0][0] as Cobranca;

  beforeEach(() => {
    jest.resetAllMocks();
    cobrancas.findByOsId.mockResolvedValue(null);
    cobrancas.save.mockResolvedValue(undefined);
    outbox.append.mockResolvedValue(undefined);
  });

  it('handles os.cobranca.solicitada', () => {
    expect(handler.evento).toBe('os.cobranca.solicitada');
  });

  it('creates the gateway payment and persists a PENDENTE cobranca', async () => {
    orcamentos.findByOsId.mockResolvedValue(orcamento());
    gateway.criarPagamento.mockResolvedValue({
      id: 'pay-1',
      status: 'pending',
      amountCents: 15050,
      currency: 'BRL',
      checkoutUrl: 'http://public/gateway/checkout/pay-1',
      metadata: null,
    });

    await handler.handle(message(), tx);

    expect(cobrancas.findByOsId).toHaveBeenCalledWith(OS_ID, tx);
    expect(orcamentos.findByOsId).toHaveBeenCalledWith(OS_ID, tx);
    expect(gateway.criarPagamento).toHaveBeenCalledWith({
      idempotencyKey: `${SAGA_ID}:${OS_ID}`,
      amountCents: 15050,
      currency: 'BRL',
      description: `OS ${OS_ID}`,
      metadata: { osId: OS_ID, orcamentoId: ORC_ID, sagaId: SAGA_ID },
    });
    expect(cobrancas.save).toHaveBeenCalledWith(expect.any(Cobranca), tx);
    const c = savedCobranca();
    expect(c.status).toBe(StatusCobranca.PENDENTE);
    expect(c.osId).toBe(OS_ID);
    expect(c.orcamentoId).toBe(ORC_ID);
    expect(c.gatewayPaymentId).toBe('pay-1');
    expect(c.checkoutUrl).toBe('http://public/gateway/checkout/pay-1');
    expect(c.valor).toBe(150.5);
    expect(c.correlationId).toBe('corr-1');
    expect(c.sagaId).toBe(SAGA_ID);
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('is a no-op when a cobranca already exists for the OS', async () => {
    cobrancas.findByOsId.mockResolvedValue(
      Cobranca.recusada({ osId: OS_ID, valor: 0, motivo: 'valor_zero' }),
    );

    await handler.handle(message(), tx);

    expect(orcamentos.findByOsId).not.toHaveBeenCalled();
    expect(gateway.criarPagamento).not.toHaveBeenCalled();
    expect(cobrancas.save).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it.each([
    ['orcamento_inexistente', null, 0],
    ['orcamento_nao_aprovado', orcamento(StatusOrcamento.GERADO, 150.5), 150.5],
    ['orcamento_nao_aprovado', orcamento(StatusOrcamento.REPROVADO, 99), 99],
    ['valor_zero', orcamento(StatusOrcamento.APROVADO, 0), 0],
  ])(
    'refuses with motivo=%s: persists RECUSADA and writes pagamento.recusado',
    async (motivo, found, valor) => {
      orcamentos.findByOsId.mockResolvedValue(found);

      await handler.handle(message(), tx);

      expect(gateway.criarPagamento).not.toHaveBeenCalled();
      const c = savedCobranca();
      expect(c.status).toBe(StatusCobranca.RECUSADA);
      expect(c.motivo).toBe(motivo);
      expect(c.valor).toBe(valor);
      expect(c.orcamentoId).toBe(found ? ORC_ID : undefined);
      expect(c.gatewayPaymentId).toBeUndefined();
      expect(outbox.append).toHaveBeenCalledWith(tx, [
        {
          evento: 'pagamento.recusado',
          aggregateType: 'cobranca',
          aggregateId: c.id,
          payload: {
            osId: OS_ID,
            cobrancaId: null,
            valor,
            status: 'RECUSADA',
            motivo,
          },
          correlationId: 'corr-1',
          traceparent: '00-abc-def-01',
        },
      ]);
    },
  );

  it('generates a correlationId when the message has none', async () => {
    orcamentos.findByOsId.mockResolvedValue(null);

    await handler.handle({ ...message(), correlationId: undefined }, tx);

    const [, events] = outbox.append.mock.calls[0] as [
      unknown,
      { correlationId: string }[],
    ];
    expect(events[0].correlationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('propagates PaymentGatewayUnavailableError (message is retried)', async () => {
    orcamentos.findByOsId.mockResolvedValue(orcamento());
    gateway.criarPagamento.mockRejectedValue(
      new PaymentGatewayUnavailableError('down'),
    );

    await expect(handler.handle(message(), tx)).rejects.toBeInstanceOf(
      PaymentGatewayUnavailableError,
    );
    expect(cobrancas.save).not.toHaveBeenCalled();
  });

  it('propagates PaymentGatewayConflictError', async () => {
    orcamentos.findByOsId.mockResolvedValue(orcamento());
    gateway.criarPagamento.mockRejectedValue(
      new PaymentGatewayConflictError('conflict'),
    );

    await expect(handler.handle(message(), tx)).rejects.toBeInstanceOf(
      PaymentGatewayConflictError,
    );
  });

  it('treats P2002 on save (PENDENTE) as a no-op', async () => {
    orcamentos.findByOsId.mockResolvedValue(orcamento());
    gateway.criarPagamento.mockResolvedValue({
      id: 'pay-1',
      status: 'pending',
      amountCents: 15050,
      currency: 'BRL',
      checkoutUrl: 'http://x',
      metadata: null,
    });
    cobrancas.save.mockRejectedValue(p2002());

    await expect(handler.handle(message(), tx)).resolves.toBeUndefined();
  });

  it('treats P2002 on save (RECUSADA) as a no-op without writing the event', async () => {
    orcamentos.findByOsId.mockResolvedValue(null);
    cobrancas.save.mockRejectedValue(p2002());

    await expect(handler.handle(message(), tx)).resolves.toBeUndefined();
    expect(outbox.append).not.toHaveBeenCalled();
  });

  it('rethrows other persistence errors', async () => {
    orcamentos.findByOsId.mockResolvedValue(null);
    cobrancas.save.mockRejectedValue(new Error('db down'));

    await expect(handler.handle(message(), tx)).rejects.toThrow('db down');
  });

  it('requires the IdempotentProcessor transaction', async () => {
    await expect(handler.handle(message())).rejects.toThrow(/transação/);
  });

  it.each([
    ['not an object', 'x'],
    ['missing id', { id: undefined }],
    ['blank id', { id: '  ' }],
    ['missing sagaId', { sagaId: undefined }],
  ])('rejects an invalid payload (%s)', async (_label, payload) => {
    const msg =
      typeof payload === 'string'
        ? { ...message(), payload }
        : message(payload);

    await expect(handler.handle(msg, tx)).rejects.toBeInstanceOf(
      CobrancaSolicitadaPayloadInvalidoError,
    );
    expect(cobrancas.findByOsId).not.toHaveBeenCalled();
  });
});
