import { createHmac } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import { WebhookNotifier, WebhookPayload } from './webhook-notifier.service';

const payload: WebhookPayload = {
  payment_id: 'p1',
  status: 'approved',
  amount_cents: 100,
  currency: 'BRL',
  metadata: { a: 1 },
  occurred_at: '2026-11-16T12:00:00.000Z',
};

describe('WebhookNotifier', () => {
  let env: Record<string, string | undefined>;
  let fetchMock: jest.Mock;
  let notifier: WebhookNotifier;
  const realFetch = global.fetch;

  beforeEach(() => {
    env = {
      PAYMENT_WEBHOOK_URL: 'http://hook.test/x',
      PAYMENT_WEBHOOK_SECRET: 's3cret',
    };
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    notifier = new WebhookNotifier({
      get: (k: string) => env[k],
    } as unknown as ConfigService);
    jest.spyOn(notifier['logger'], 'warn').mockImplementation();
  });
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it('signs the exact body sent', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const res = await notifier.notify(payload);
    expect(res).toEqual({ delivered: true, statusCode: 200 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://hook.test/x');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(payload));
    const h = init.headers as Record<string, string>;
    expect(h['content-type']).toBe('application/json');
    const expected = createHmac('sha256', 's3cret')
      .update(`${h['x-signature-timestamp']}.${init.body as string}`)
      .digest('hex');
    expect(h['x-signature']).toBe(expected);
    expect(h['x-signature-timestamp']).toMatch(/^\d{10}$/);
  });

  it('returns delivered false on non-2xx', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    expect(await notifier.notify(payload)).toEqual({
      delivered: false,
      statusCode: 500,
      error: 'status_500',
    });
  });

  it('returns delivered false on network error', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    expect(await notifier.notify(payload)).toEqual({
      delivered: false,
      error: 'boom',
    });
    fetchMock.mockRejectedValue('x');
    expect(await notifier.notify(payload)).toEqual({
      delivered: false,
      error: 'error',
    });
  });

  it('aborts on timeout', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(
      (_u: string, init: RequestInit) =>
        new Promise((_r, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const p = notifier.notify(payload);
    await jest.advanceTimersByTimeAsync(5000);
    expect(await p).toEqual({ delivered: false, error: 'aborted' });
  });

  it.each(['PAYMENT_WEBHOOK_URL', 'PAYMENT_WEBHOOK_SECRET'])(
    'missing %s',
    async (k) => {
      delete env[k];
      expect(await notifier.notify(payload)).toEqual({
        delivered: false,
        error: 'webhook_not_configured',
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
