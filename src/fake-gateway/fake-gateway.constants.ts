/**
 * Simulated payment gateway. Everything under src/fake-gateway behaves like a
 * third-party provider: it must never depend on billing domain code.
 */
export const GATEWAY_JWT_SERVICE = Symbol('GATEWAY_JWT_SERVICE');

export const GATEWAY_TOKEN_AUDIENCE = 'payment-gateway';
export const GATEWAY_TOKEN_ISSUER = 'fake-gateway';
export const GATEWAY_TOKEN_TTL_SECONDS = 300;
export const GATEWAY_TOKEN_ALGORITHM = 'HS256';

export const GATEWAY_DEFAULT_CURRENCY = 'BRL';
