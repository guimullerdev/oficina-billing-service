import {
  BadRequestException,
  HttpException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import {
  GATEWAY_TOKEN_AUDIENCE,
  GATEWAY_TOKEN_ISSUER,
} from '../fake-gateway.constants';
import { GatewayConfigService } from '../gateway-config.service';
import { extractClientCredentials, safeEqual } from './client-credentials';
import { GatewayOAuthController } from './gateway-oauth.controller';
import { GatewayTokenService } from './gateway-token.service';

const ENV = {
  GATEWAY_CLIENT_ID: 'billing-local',
  GATEWAY_CLIENT_SECRET: 's3cr3t',
  GATEWAY_JWT_SECRET: 'gateway-jwt-secret',
  GATEWAY_PUBLIC_BASE_URL: 'http://localhost:3000/',
};

const makeGatewayConfig = (env: Record<string, string | undefined>) =>
  new GatewayConfigService({ get: (key: string) => env[key] } as never);

const basic = (id: string, secret: string) =>
  `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;

const errorBody = (err: unknown) => (err as HttpException).getResponse();

describe('GatewayOAuthController (POST /gateway/oauth/token)', () => {
  const jwt = new JwtService({});
  const build = (env: Record<string, string | undefined> = ENV) =>
    new GatewayOAuthController(
      new GatewayTokenService(jwt, makeGatewayConfig(env)),
    );

  const expectValidToken = async (res: {
    access_token: string;
    token_type: string;
    expires_in: number;
  }) => {
    expect(res.token_type).toBe('Bearer');
    expect(res.expires_in).toBe(300);
    const claims = await jwt.verifyAsync<Record<string, unknown>>(
      res.access_token,
      {
        secret: ENV.GATEWAY_JWT_SECRET,
        audience: GATEWAY_TOKEN_AUDIENCE,
        issuer: GATEWAY_TOKEN_ISSUER,
        algorithms: ['HS256'],
      },
    );
    expect(claims.sub).toBe('billing-local');
    expect((claims.exp as number) - (claims.iat as number)).toBe(300);
    const header = JSON.parse(
      Buffer.from(res.access_token.split('.')[0], 'base64url').toString(),
    ) as { alg: string };
    expect(header.alg).toBe('HS256');
  };

  it('issues a token with credentials in the body (form or JSON)', async () => {
    const res = await build().token(undefined, {
      grant_type: 'client_credentials',
      client_id: 'billing-local',
      client_secret: 's3cr3t',
    });
    await expectValidToken(res);
  });

  it('issues a token with HTTP Basic credentials', async () => {
    const res = await build().token(basic('billing-local', 's3cr3t'), {
      grant_type: 'client_credentials',
    });
    await expectValidToken(res);
  });

  it('issues a token with url-encoded Basic credentials', async () => {
    const res = await build({
      ...ENV,
      GATEWAY_CLIENT_SECRET: 'a:b c',
    }).token(basic('billing-local', 'a%3Ab%20c'), {
      grant_type: 'client_credentials',
    });
    await expectValidToken(res);
  });

  it('400 unsupported_grant_type for a wrong or missing grant', async () => {
    for (const body of [{ grant_type: 'password' }, {}, undefined]) {
      const err = await build()
        .token(basic('billing-local', 's3cr3t'), body)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(errorBody(err)).toEqual({ error: 'unsupported_grant_type' });
    }
  });

  it.each([
    ['wrong secret', basic('billing-local', 'nope'), {}],
    ['wrong client id', basic('other', 's3cr3t'), {}],
    ['malformed basic', 'Basic bm9jb2xvbg==', {}],
    ['empty basic', 'Basic', {}],
    ['no credentials', undefined, {}],
    [
      'wrong body secret',
      undefined,
      { client_id: 'billing-local', client_secret: 'x' },
    ],
  ])('401 invalid_client on %s', async (_label, auth, extra) => {
    const err = await build()
      .token(auth, { grant_type: 'client_credentials', ...extra })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect(errorBody(err)).toEqual({ error: 'invalid_client' });
  });

  it.each(['GATEWAY_CLIENT_ID', 'GATEWAY_CLIENT_SECRET', 'GATEWAY_JWT_SECRET'])(
    '503 gateway_not_configured when %s is missing',
    async (key) => {
      const err = await build({ ...ENV, [key]: undefined })
        .token(basic('billing-local', 's3cr3t'), {
          grant_type: 'client_credentials',
        })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(errorBody(err)).toEqual({ error: 'gateway_not_configured' });
    },
  );
});

describe('client credentials helpers', () => {
  it('safeEqual compares strings of any length', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', 'a')).toBe(false);
  });

  it('ignores non-Basic authorization and non-string body fields', () => {
    expect(extractClientCredentials('Bearer x', {})).toBeNull();
    expect(
      extractClientCredentials(undefined, { client_id: 1, client_secret: 2 }),
    ).toBeNull();
  });

  it('keeps raw values that are not valid percent-encoding', () => {
    expect(extractClientCredentials(basic('id', '100%'), undefined)).toEqual({
      clientId: 'id',
      clientSecret: '100%',
    });
  });
});

describe('GatewayConfigService', () => {
  it('strips trailing slashes from the public base URL', () => {
    expect(makeGatewayConfig(ENV).publicBaseUrl()).toBe(
      'http://localhost:3000',
    );
  });

  it('treats blank values as missing', () => {
    expect(() =>
      makeGatewayConfig({ GATEWAY_PUBLIC_BASE_URL: '  ' }).publicBaseUrl(),
    ).toThrow(ServiceUnavailableException);
  });
});
