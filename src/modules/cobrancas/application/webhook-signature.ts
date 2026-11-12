import { createHmac, timingSafeEqual } from 'node:crypto';

/** Janela aceita entre o timestamp assinado e o relógio local (anti-replay). */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

const UNIX_SECONDS_RE = /^\d+$/;
/** HMAC-SHA256 em hex: 32 bytes = 64 caracteres. */
const SHA256_HEX_RE = /^[0-9a-f]{64}$/i;

export type SignatureFailureReason =
  | 'missing_secret'
  | 'missing_signature'
  | 'missing_timestamp'
  | 'invalid_timestamp'
  | 'timestamp_out_of_tolerance'
  | 'invalid_signature_format'
  | 'signature_mismatch';

export type SignatureVerification =
  { ok: true } | { ok: false; reason: SignatureFailureReason };

const fail = (reason: SignatureFailureReason): SignatureVerification => ({
  ok: false,
  reason,
});

/**
 * Verifica a assinatura do webhook do gateway de pagamentos:
 * `x-signature` = hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)), com
 * `x-signature-timestamp` em segundos unix. A assinatura é calculada sobre os
 * bytes recebidos (não sobre o JSON re-serializado) e comparada em tempo
 * constante. Sem segredo configurado, nada é aceito.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHex: string | undefined,
  timestamp: string | undefined,
  secret: string | undefined,
  nowSeconds: number,
): SignatureVerification {
  if (!secret) return fail('missing_secret');
  if (!signatureHex) return fail('missing_signature');
  if (!timestamp) return fail('missing_timestamp');
  if (!UNIX_SECONDS_RE.test(timestamp)) return fail('invalid_timestamp');
  if (Math.abs(nowSeconds - Number(timestamp)) > SIGNATURE_TOLERANCE_SECONDS) {
    return fail('timestamp_out_of_tolerance');
  }
  if (!SHA256_HEX_RE.test(signatureHex)) {
    return fail('invalid_signature_format');
  }

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest();
  const received = Buffer.from(signatureHex, 'hex');
  // Ambos têm 32 bytes (garantido pelo formato validado acima).
  return timingSafeEqual(expected, received)
    ? { ok: true }
    : fail('signature_mismatch');
}
