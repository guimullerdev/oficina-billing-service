import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import {
  GatewayClient,
  GatewayTokenService,
} from '../oauth/gateway-token.service';

export type GatewayRequest = Request & { gatewayClient?: GatewayClient };

/**
 * Accepts only access tokens issued by POST /gateway/oauth/token (signed with
 * GATEWAY_JWT_SECRET, aud=payment-gateway, iss=fake-gateway).
 */
@Injectable()
export class GatewayAuthGuard implements CanActivate {
  constructor(private readonly tokens: GatewayTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GatewayRequest>();
    request.gatewayClient = await this.tokens.verify(
      extractBearer(request.headers.authorization),
    );
    return true;
  }
}

function extractBearer(authorization: string | undefined): string | undefined {
  const [scheme, token, ...rest] = authorization?.trim().split(/\s+/) ?? [];
  if (scheme !== 'Bearer' || rest.length > 0) return undefined;
  return token;
}
