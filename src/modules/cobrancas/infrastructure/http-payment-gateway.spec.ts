import {
  PaymentGatewayConflictError,
  PaymentGatewayError,
  PaymentGatewayUnavailableError,
} from '../application/ports/payment-gateway.port';
import {
  DEFAULT_GATEWAY_BASE_URL,
  HttpPaymentGateway,
  resolveGatewayBaseUrl,
} from './http-payment-gateway';

const BASE = 'http://gw.local/gateway';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const tokenResponse = (token = 'tok-1', expiresIn = 300) =>
  json(200, {
    access_token: token,
    token_type: 'Bearer',
    expires_in: expiresIn,
  });

const paymentBody = {
  id: 'pay-1',
  status: 'pending',
  amount_cents: 15000,
  currency: 'BRL',
  description: 'OS os-1',
  metadata: { osId: 'os-1' },
  checkout_url: 'http://public/gateway/checkout/pay-1',
  created_at: '2026-01-01T00:00:00.000Z',
};

const criarInput = {
  idempotencyKey: 'saga-1:os-1',
  amountCents: 15000,
  currency: 'BRL',
  description: 'OS os-1',
  metadata: { osId: 'os-1' },
};

type FetchMock = jest.Mock<Promise<Response>, [string, RequestInit]>;

describe('HttpPaymentGateway', () => {
  let fetchFn: FetchMock;
  let clock: number;

  const build = (opts: Partial<{ timeoutMs: number; clientId: string }> = {}) =>
    new HttpPaymentGateway({
      baseUrl: BASE,
      clientId: 'clientId' in opts ? opts.clientId : 'billing',
      clientSecret: 'secret',
      timeoutMs: opts.timeoutMs,
      fetchFn,
      now: () => clock,
    });

  const urls = () => fetchFn.mock.calls.map(([url]) => url);

  beforeEach(() => {
    fetchFn = jest.fn();
    clock = 1_000_000;
  });

  it('requests a client_credentials token (form-urlencoded) and creates the payment', async () => {
    fetchFn
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(json(201, paymentBody));

    const result = await build().criarPagamento(criarInput);

    expect(result).toEqual({
      id: 'pay-1',
      status: 'pending',
      amountCents: 15000,
      currency: 'BRL',
      checkoutUrl: 'http://public/gateway/checkout/pay-1',
      metadata: { osId: 'os-1' },
    });

    const [tokenUrl, tokenInit] = fetchFn.mock.calls[0];
    expect(tokenUrl).toBe(`${BASE}/oauth/token`);
    expect(tokenInit.method).toBe('POST');
    expect((tokenInit.headers as Record<string, string>)['content-type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const form = new URLSearchParams(tokenInit.body as string);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('client_id')).toBe('billing');
    expect(form.get('client_secret')).toBe('secret');

    const [payUrl, payInit] = fetchFn.mock.calls[1];
    expect(payUrl).toBe(`${BASE}/payments`);
    expect(payInit.method).toBe('POST');
    const headers = payInit.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tok-1');
    expect(headers['idempotency-key']).toBe('saga-1:os-1');
    expect(JSON.parse(payInit.body as string)).toEqual({
      amount_cents: 15000,
      currency: 'BRL',
      description: 'OS os-1',
      metadata: { osId: 'os-1' },
    });
  });

  it('reuses the cached token across calls', async () => {
    fetchFn
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(json(201, paymentBody))
      .mockResolvedValueOnce(json(200, paymentBody));
    const gw = build();

    await gw.criarPagamento(criarInput);
    clock += 200_000;
    const found = await gw.consultarPagamento('pay-1');

    expect(found.id).toBe('pay-1');
    expect(urls()).toEqual([
      `${BASE}/oauth/token`,
      `${BASE}/payments`,
      `${BASE}/payments/pay-1`,
    ]);
    expect(fetchFn.mock.calls[2][1].method).toBe('GET');
  });

  it('refreshes the token 30s before expiry', async () => {
    fetchFn
      .mockResolvedValueOnce(tokenResponse('tok-1'))
      .mockResolvedValueOnce(json(201, paymentBody))
      .mockResolvedValueOnce(tokenResponse('tok-2'))
      .mockResolvedValueOnce(json(200, paymentBody));
    const gw = build();

    await gw.criarPagamento(criarInput);
    clock += 271_000; // 300s - 30s margin already passed
    await gw.consultarPagamento('pay-1');

    expect(urls()).toEqual([
      `${BASE}/oauth/token`,
      `${BASE}/payments`,
      `${BASE}/oauth/token`,
      `${BASE}/payments/pay-1`,
    ]);
    expect(
      (fetchFn.mock.calls[3][1].headers as Record<string, string>)
        .authorization,
    ).toBe('Bearer tok-2');
  });

  it('shares a single in-flight token request between concurrent calls', async () => {
    fetchFn.mockImplementation((url) =>
      Promise.resolve(
        url.endsWith('/oauth/token') ? tokenResponse() : json(200, paymentBody),
      ),
    );
    const gw = build();

    await Promise.all([
      gw.consultarPagamento('pay-1'),
      gw.consultarPagamento('pay-1'),
    ]);

    expect(urls().filter((u) => u.endsWith('/oauth/token'))).toHaveLength(1);
  });

  it('on 401 invalidates the token, fetches a new one and retries once', async () => {
    fetchFn
      .mockResolvedValueOnce(tokenResponse('tok-1'))
      .mockResolvedValueOnce(json(401, { error: 'invalid_token' }))
      .mockResolvedValueOnce(tokenResponse('tok-2'))
      .mockResolvedValueOnce(json(201, paymentBody));

    const result = await build().criarPagamento(criarInput);

    expect(result.id).toBe('pay-1');
    expect(urls()).toEqual([
      `${BASE}/oauth/token`,
      `${BASE}/payments`,
      `${BASE}/oauth/token`,
      `${BASE}/payments`,
    ]);
    expect(
      (fetchFn.mock.calls[3][1].headers as Record<string, string>)
        .authorization,
    ).toBe('Bearer tok-2');
  });

  it('fails on a second 401', async () => {
    fetchFn
      .mockResolvedValueOnce(tokenResponse('tok-1'))
      .mockResolvedValueOnce(json(401, { error: 'invalid_token' }))
      .mockResolvedValueOnce(tokenResponse('tok-2'))
      .mockResolvedValueOnce(json(401, { error: 'invalid_token' }));

    const err = await build()
      .criarPagamento(criarInput)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PaymentGatewayError);
    expect(err).not.toBeInstanceOf(PaymentGatewayUnavailableError);
    expect((err as PaymentGatewayError).status).toBe(401);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('maps 409 to PaymentGatewayConflictError', async () => {
    fetchFn
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(json(409, { error: 'idempotency_key_conflict' }));

    await expect(build().criarPagamento(criarInput)).rejects.toBeInstanceOf(
      PaymentGatewayConflictError,
    );
  });

  it.each([500, 502, 503])(
    'maps %i to PaymentGatewayUnavailableError',
    async (status) => {
      fetchFn
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(json(status, { error: 'x' }));

      await expect(build().criarPagamento(criarInput)).rejects.toBeInstanceOf(
        PaymentGatewayUnavailableError,
      );
    },
  );

  it('maps other 4xx to a generic PaymentGatewayError', async () => {
    fetchFn
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(json(404, { error: 'payment_not_found' }));

    const err = await build()
      .consultarPagamento('nope')
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PaymentGatewayError);
    expect((err as PaymentGatewayError).status).toBe(404);
  });

  it('maps a timeout to PaymentGatewayUnavailableError', async () => {
    fetchFn.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }),
    );

    const err = await build({ timeoutMs: 5 })
      .criarPagamento(criarInput)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PaymentGatewayUnavailableError);
    expect((err as Error).message).toMatch(/timeout/i);
  });

  it('maps a network error to PaymentGatewayUnavailableError', async () => {
    fetchFn.mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(build().criarPagamento(criarInput)).rejects.toBeInstanceOf(
      PaymentGatewayUnavailableError,
    );
  });

  it('maps a 5xx token response to PaymentGatewayUnavailableError', async () => {
    fetchFn.mockResolvedValueOnce(
      json(503, { error: 'gateway_not_configured' }),
    );

    await expect(build().criarPagamento(criarInput)).rejects.toBeInstanceOf(
      PaymentGatewayUnavailableError,
    );
  });

  it('maps a rejected token request (invalid_client) to PaymentGatewayError', async () => {
    fetchFn.mockResolvedValueOnce(json(401, { error: 'invalid_client' }));

    const err = await build()
      .criarPagamento(criarInput)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PaymentGatewayError);
    expect((err as PaymentGatewayError).status).toBe(401);
  });

  it('rejects a token response without access_token', async () => {
    fetchFn.mockResolvedValueOnce(json(200, { token_type: 'Bearer' }));

    await expect(build().criarPagamento(criarInput)).rejects.toBeInstanceOf(
      PaymentGatewayError,
    );
  });

  it('rejects a payment response that is not a payment', async () => {
    fetchFn
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response('not json', { status: 200 }));

    await expect(build().consultarPagamento('pay-1')).rejects.toBeInstanceOf(
      PaymentGatewayError,
    );
  });

  it('fails as unavailable without client credentials (no request sent)', async () => {
    await expect(
      build({ clientId: undefined }).criarPagamento(criarInput),
    ).rejects.toBeInstanceOf(PaymentGatewayUnavailableError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('maps a missing metadata to null and encodes the payment id', async () => {
    fetchFn
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(
        json(200, { ...paymentBody, metadata: null, id: 'a/b' }),
      );

    const result = await build().consultarPagamento('a/b');

    expect(result.metadata).toBeNull();
    expect(urls()[1]).toBe(`${BASE}/payments/a%2Fb`);
  });
});

describe('resolveGatewayBaseUrl', () => {
  it('defaults to the local gateway', () => {
    expect(resolveGatewayBaseUrl(undefined)).toBe(DEFAULT_GATEWAY_BASE_URL);
    expect(resolveGatewayBaseUrl('  ')).toBe(DEFAULT_GATEWAY_BASE_URL);
    expect(DEFAULT_GATEWAY_BASE_URL).toBe('http://localhost:3000/gateway');
  });

  it('strips trailing slashes', () => {
    expect(resolveGatewayBaseUrl('http://svc/gateway//')).toBe(
      'http://svc/gateway',
    );
  });
});
