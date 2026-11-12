import { createHmac } from 'node:crypto';

import {
  SIGNATURE_TOLERANCE_SECONDS,
  verifyWebhookSignature,
} from './webhook-signature';

const SECRET = 'webhook-secret';
const NOW = 1_800_000_000;
const BODY = Buffer.from(
  JSON.stringify({ payment_id: 'pay-1', status: 'approved' }),
);

const sign = (body: Buffer, ts: string, secret = SECRET): string =>
  createHmac('sha256', secret).update(`${ts}.${body.toString()}`).digest('hex');

describe('verifyWebhookSignature', () => {
  const ts = String(NOW);

  it('accepts a valid signature', () => {
    expect(
      verifyWebhookSignature(BODY, sign(BODY, ts), ts, SECRET, NOW),
    ).toEqual({ ok: true });
  });

  it('accepts an uppercase hex signature', () => {
    const sig = sign(BODY, ts).toUpperCase();
    expect(verifyWebhookSignature(BODY, sig, ts, SECRET, NOW)).toEqual({
      ok: true,
    });
  });

  it('accepts a timestamp exactly at the tolerance limit', () => {
    const old = String(NOW - SIGNATURE_TOLERANCE_SECONDS);
    expect(
      verifyWebhookSignature(BODY, sign(BODY, old), old, SECRET, NOW),
    ).toEqual({ ok: true });
  });

  it('rejects when the secret is not configured', () => {
    for (const secret of [undefined, '']) {
      expect(
        verifyWebhookSignature(BODY, sign(BODY, ts), ts, secret, NOW),
      ).toEqual({ ok: false, reason: 'missing_secret' });
    }
  });

  it('rejects a missing signature header', () => {
    for (const sig of [undefined, '']) {
      expect(verifyWebhookSignature(BODY, sig, ts, SECRET, NOW)).toEqual({
        ok: false,
        reason: 'missing_signature',
      });
    }
  });

  it('rejects a missing timestamp header', () => {
    for (const missing of [undefined, '']) {
      expect(
        verifyWebhookSignature(BODY, sign(BODY, ts), missing, SECRET, NOW),
      ).toEqual({ ok: false, reason: 'missing_timestamp' });
    }
  });

  it.each(['abc', '12.5', '-100', '1e9', ` ${NOW}`])(
    'rejects a non-numeric timestamp (%p)',
    (bad) => {
      expect(
        verifyWebhookSignature(BODY, sign(BODY, bad), bad, SECRET, NOW),
      ).toEqual({ ok: false, reason: 'invalid_timestamp' });
    },
  );

  it('rejects a timestamp older than the tolerance', () => {
    const old = String(NOW - SIGNATURE_TOLERANCE_SECONDS - 1);
    expect(
      verifyWebhookSignature(BODY, sign(BODY, old), old, SECRET, NOW),
    ).toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' });
  });

  it('rejects a timestamp too far in the future', () => {
    const future = String(NOW + SIGNATURE_TOLERANCE_SECONDS + 1);
    expect(
      verifyWebhookSignature(BODY, sign(BODY, future), future, SECRET, NOW),
    ).toEqual({ ok: false, reason: 'timestamp_out_of_tolerance' });
  });

  it('rejects a non-hex signature', () => {
    const sig = 'z'.repeat(64);
    expect(verifyWebhookSignature(BODY, sig, ts, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'invalid_signature_format',
    });
  });

  it('rejects a hex signature with the wrong length', () => {
    const sig = sign(BODY, ts).slice(0, 62);
    expect(verifyWebhookSignature(BODY, sig, ts, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'invalid_signature_format',
    });
  });

  it('rejects a signature made with another secret', () => {
    const sig = sign(BODY, ts, 'other-secret');
    expect(verifyWebhookSignature(BODY, sig, ts, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    });
  });

  it('rejects a signature over a different body', () => {
    const sig = sign(Buffer.from('{"payment_id":"pay-2"}'), ts);
    expect(verifyWebhookSignature(BODY, sig, ts, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    });
  });

  it('rejects a signature over a different timestamp', () => {
    const sig = sign(BODY, String(NOW - 1));
    expect(verifyWebhookSignature(BODY, sig, ts, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    });
  });
});
