import { createHash, timingSafeEqual } from 'node:crypto';

export interface ClientCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Constant-time comparison that is also safe for inputs of different
 * lengths: both sides are hashed to a fixed-size digest first.
 */
export function safeEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf8').digest();
  const digestB = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * OAuth2 client authentication (RFC 6749 section 2.3.1): HTTP Basic takes
 * precedence; otherwise client_id/client_secret from the request body.
 */
export function extractClientCredentials(
  authorization: string | undefined,
  body: Record<string, unknown> | undefined,
): ClientCredentials | null {
  const [scheme, encoded] = authorization?.trim().split(/\s+/) ?? [];
  if (scheme?.toLowerCase() === 'basic') {
    return encoded ? parseBasic(encoded) : null;
  }

  const clientId = body?.client_id;
  const clientSecret = body?.client_secret;
  if (typeof clientId === 'string' && typeof clientSecret === 'string') {
    return { clientId, clientSecret };
  }
  return null;
}

function parseBasic(encoded: string): ClientCredentials | null {
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return null;
  return {
    clientId: formDecode(decoded.slice(0, separator)),
    clientSecret: formDecode(decoded.slice(separator + 1)),
  };
}

function formDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
