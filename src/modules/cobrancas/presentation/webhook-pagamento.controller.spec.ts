import { createHmac } from 'node:crypto';

import { INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { CobrancaNaoEncontradaError } from '../application/errors/cobranca-nao-encontrada.error';
import {
  PaymentGatewayError,
  PaymentGatewayUnavailableError,
} from '../application/ports/payment-gateway.port';
import { ProcessarWebhookPagamentoUseCase } from '../application/use-cases/processar-webhook-pagamento.usecase';
import { StatusCobranca } from '../domain/cobranca.entity';
import { WebhookPagamentoController } from './webhook-pagamento.controller';

const SECRET = 'webhook-secret';
const PAY_ID = '44444444-4444-4444-8444-444444444444';
const PATH = '/webhooks/pagamento';

const notifierBody = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    payment_id: PAY_ID,
    status: 'approved',
    amount_cents: 15050,
    currency: 'BRL',
    metadata: { osId: 'os-1' },
    occurred_at: '2026-11-12T10:00:00.000Z',
    ...overrides,
  });

const signedHeaders = (
  body: string,
  secret = SECRET,
  ts = Math.floor(Date.now() / 1000).toString(),
): Record<string, string> => ({
  'x-signature': createHmac('sha256', secret)
    .update(`${ts}.${body}`)
    .digest('hex'),
  'x-signature-timestamp': ts,
});

describe('WebhookPagamentoController (http)', () => {
  let app: INestApplication;
  let base: string;
  const env: Record<string, string | undefined> = {};
  const processar = { execute: jest.fn() };

  const post = (
    body: string,
    headers: Record<string, string>,
    contentType = 'application/json',
  ) =>
    fetch(`${base}${PATH}`, {
      method: 'POST',
      headers: { 'content-type': contentType, ...headers },
      body,
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WebhookPagamentoController],
      providers: [
        { provide: ProcessarWebhookPagamentoUseCase, useValue: processar },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => env[key] },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    // Same global pipe as main.ts: the webhook must not be affected by it.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0);
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    env.PAYMENT_WEBHOOK_SECRET = SECRET;
    processar.execute.mockResolvedValue({ status: StatusCobranca.CONFIRMADA });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => jest.restoreAllMocks());

  it('200: processes a correctly signed webhook (extra fields are accepted)', async () => {
    const body = notifierBody();

    const res = await post(body, signedHeaders(body));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'CONFIRMADA' });
    expect(processar.execute).toHaveBeenCalledWith(PAY_ID, 'approved');
  });

  it('200: passes no status to the use case when the body has none', async () => {
    const body = JSON.stringify({ payment_id: PAY_ID });

    const res = await post(body, signedHeaders(body));

    expect(res.status).toBe(200);
    expect(processar.execute).toHaveBeenCalledWith(PAY_ID, undefined);
  });

  it('401: rejects a wrong signature', async () => {
    const body = notifierBody();

    const res = await post(body, signedHeaders(body, 'other-secret'));

    expect(res.status).toBe(401);
    expect(processar.execute).not.toHaveBeenCalled();
  });

  it('401: rejects a body tampered after signing', async () => {
    const headers = signedHeaders(notifierBody());

    const res = await post(notifierBody({ status: 'declined' }), headers);

    expect(res.status).toBe(401);
    expect(processar.execute).not.toHaveBeenCalled();
  });

  it('401: rejects a content type without raw body (signature checked over empty body)', async () => {
    const body = notifierBody();

    const res = await post(body, signedHeaders(body), 'text/plain');

    expect(res.status).toBe(401);
    expect(processar.execute).not.toHaveBeenCalled();
  });

  it('401: rejects missing signature headers', async () => {
    const res = await post(notifierBody(), {});

    expect(res.status).toBe(401);
    expect(processar.execute).not.toHaveBeenCalled();
  });

  it('401: rejects everything and logs an error when the secret is not configured', async () => {
    env.PAYMENT_WEBHOOK_SECRET = undefined;
    const body = notifierBody();

    const res = await post(body, signedHeaders(body));

    expect(res.status).toBe(401);
    expect(Logger.prototype.error).toHaveBeenCalledWith(
      expect.stringContaining('PAYMENT_WEBHOOK_SECRET'),
    );
    expect(processar.execute).not.toHaveBeenCalled();
  });

  it('400: rejects malformed JSON', async () => {
    const res = await post('{"payment_id":', {});

    expect(res.status).toBe(400);
    expect(processar.execute).not.toHaveBeenCalled();
  });

  it('400: rejects a signed body that is not JSON', async () => {
    const body = 'payment_id=abc';

    const res = await post(
      body,
      signedHeaders(body),
      'application/x-www-form-urlencoded',
    );

    expect(res.status).toBe(400);
    expect(processar.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['an array', '[]'],
    ['no payment_id', JSON.stringify({ status: 'approved' })],
    ['an empty payment_id', notifierBody({ payment_id: '  ' })],
  ])('400: rejects a signed body with %s', async (_label, body) => {
    const res = await post(body, signedHeaders(body));

    expect(res.status).toBe(400);
    expect(processar.execute).not.toHaveBeenCalled();
  });

  it('404: unknown payment_id', async () => {
    processar.execute.mockRejectedValue(
      new CobrancaNaoEncontradaError(`gatewayPaymentId=${PAY_ID}`),
    );
    const body = notifierBody();

    const res = await post(body, signedHeaders(body));

    expect(res.status).toBe(404);
  });

  it('503: gateway unavailable while re-querying the payment', async () => {
    processar.execute.mockRejectedValue(
      new PaymentGatewayUnavailableError('timeout'),
    );
    const body = notifierBody();

    const res = await post(body, signedHeaders(body));

    expect(res.status).toBe(503);
  });

  it('502: unexpected gateway error while re-querying the payment', async () => {
    processar.execute.mockRejectedValue(new PaymentGatewayError('boom', 404));
    const body = notifierBody();

    const res = await post(body, signedHeaders(body));

    expect(res.status).toBe(502);
  });
});
