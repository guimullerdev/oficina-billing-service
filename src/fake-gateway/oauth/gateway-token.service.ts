import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import {
  GATEWAY_JWT_SERVICE,
  GATEWAY_TOKEN_ALGORITHM,
  GATEWAY_TOKEN_AUDIENCE,
  GATEWAY_TOKEN_ISSUER,
  GATEWAY_TOKEN_TTL_SECONDS,
} from '../fake-gateway.constants';
import { GatewayConfigService } from '../gateway-config.service';
import { ClientCredentials, safeEqual } from './client-credentials';

export interface GatewayTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

export interface GatewayClient {
  clientId: string;
}

@Injectable()
export class GatewayTokenService {
  constructor(
    @Inject(GATEWAY_JWT_SERVICE) private readonly jwt: JwtService,
    private readonly config: GatewayConfigService,
  ) {}

  async issue(
    grantType: unknown,
    credentials: ClientCredentials | null,
  ): Promise<GatewayTokenResponse> {
    const { clientId, clientSecret, jwtSecret } = this.config.clientConfig();

    if (grantType !== 'client_credentials') {
      throw new BadRequestException({ error: 'unsupported_grant_type' });
    }

    // Evaluate both comparisons so timing does not reveal which one failed.
    const idMatches = safeEqual(credentials?.clientId ?? '', clientId);
    const secretMatches = safeEqual(
      credentials?.clientSecret ?? '',
      clientSecret,
    );
    if (!credentials || !idMatches || !secretMatches) {
      throw new UnauthorizedException({ error: 'invalid_client' });
    }

    const accessToken = await this.jwt.signAsync(
      {},
      {
        secret: jwtSecret,
        algorithm: GATEWAY_TOKEN_ALGORITHM,
        subject: clientId,
        audience: GATEWAY_TOKEN_AUDIENCE,
        issuer: GATEWAY_TOKEN_ISSUER,
        expiresIn: GATEWAY_TOKEN_TTL_SECONDS,
      },
    );

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: GATEWAY_TOKEN_TTL_SECONDS,
    };
  }

  async verify(token: string | undefined): Promise<GatewayClient> {
    const secret = this.config.jwtSecret();
    if (!token) throw new UnauthorizedException({ error: 'invalid_token' });

    let subject: unknown;
    try {
      const claims = await this.jwt.verifyAsync<{ sub?: unknown }>(token, {
        secret,
        algorithms: [GATEWAY_TOKEN_ALGORITHM],
        audience: GATEWAY_TOKEN_AUDIENCE,
        issuer: GATEWAY_TOKEN_ISSUER,
      });
      subject = claims.sub;
    } catch {
      throw new UnauthorizedException({ error: 'invalid_token' });
    }

    if (typeof subject !== 'string' || !subject) {
      throw new UnauthorizedException({ error: 'invalid_token' });
    }
    return { clientId: subject };
  }
}
