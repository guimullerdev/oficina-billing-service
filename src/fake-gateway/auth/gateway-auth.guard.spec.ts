import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { GatewayConfigService } from '../gateway-config.service';
import { GatewayTokenService } from '../oauth/gateway-token.service';
import { GatewayAuthGuard, GatewayRequest } from './gateway-auth.guard';

const SECRET = 'gateway-jwt-secret';
const ENV: Record<string, string | undefined> = {
  GATEWAY_CLIENT_ID: 'billing-local',
  GATEWAY_CLIENT_SECRET: 's3cr3t',
  GATEWAY_JWT_SECRET: SECRET,
};

const makeContext = (authorization?: string) => {
  const request = { headers: { authorization } } as GatewayRequest;
  return {
    request,
    ctx: { switchToHttp: () => ({ getRequest: () => request }) } as never,
  };
};

describe('GatewayAuthGuard', () => {
  const jwt = new JwtService({});
  const build = (env = ENV) =>
    new GatewayAuthGuard(
      new GatewayTokenService(
        jwt,
        new GatewayConfigService({ get: (k: string) => env[k] } as never),
      ),
    );
  const guard = build();

  const sign = (
    overrides: Partial<{
      secret: string;
      audience: string;
      issuer: string;
      expiresIn: number;
      subject: string;
    }> = {},
  ) =>
    jwt.signAsync(
      {},
      {
        secret: SECRET,
        algorithm: 'HS256',
        subject: 'billing-local',
        audience: 'payment-gateway',
        issuer: 'fake-gateway',
        expiresIn: 300,
        ...overrides,
      },
    );

  it('accepts a valid token and exposes the client on the request', async () => {
    const { ctx, request } = makeContext(`Bearer ${await sign()}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.gatewayClient).toEqual({ clientId: 'billing-local' });
  });

  it('accepts a token issued by GatewayTokenService', async () => {
    const tokens = new GatewayTokenService(
      jwt,
      new GatewayConfigService({ get: (k: string) => ENV[k] } as never),
    );
    const { access_token } = await tokens.issue('client_credentials', {
      clientId: 'billing-local',
      clientSecret: 's3cr3t',
    });
    const { ctx } = makeContext(`Bearer ${access_token}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('401 when the Authorization header is missing', async () => {
    await expect(guard.canActivate(makeContext().ctx)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it.each(['Basic abc', 'Bearer', 'Bearer not-a-jwt', 'Token x.y.z'])(
    '401 on malformed header "%s"',
    async (header) => {
      await expect(guard.canActivate(makeContext(header).ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    },
  );

  it.each([
    ['expired', { expiresIn: -10 }],
    ['wrong audience', { audience: 'billing' }],
    ['wrong issuer', { issuer: 'someone-else' }],
    ['wrong signature', { secret: 'other-secret' }],
    ['empty subject', { subject: '' }],
  ])('401 on %s token', async (_label, overrides) => {
    const token = await sign(overrides);
    await expect(
      guard.canActivate(makeContext(`Bearer ${token}`).ctx),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('401 on a token without audience (e.g. a billing user token)', async () => {
    const token = await jwt.signAsync({ sub: 'u-1' }, { secret: SECRET });
    await expect(
      guard.canActivate(makeContext(`Bearer ${token}`).ctx),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('503 when GATEWAY_JWT_SECRET is missing', async () => {
    const unconfigured = build({ ...ENV, GATEWAY_JWT_SECRET: undefined });
    await expect(
      unconfigured.canActivate(makeContext(`Bearer ${await sign()}`).ctx),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
