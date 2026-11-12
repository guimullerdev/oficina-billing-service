import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GatewayClientConfig {
  clientId: string;
  clientSecret: string;
  jwtSecret: string;
}

/**
 * Reads GATEWAY_* lazily (per request) so the app still boots when the
 * gateway is not configured; the gateway endpoints answer 503 instead.
 */
@Injectable()
export class GatewayConfigService {
  constructor(private readonly config: ConfigService) {}

  clientConfig(): GatewayClientConfig {
    return {
      clientId: this.require('GATEWAY_CLIENT_ID'),
      clientSecret: this.require('GATEWAY_CLIENT_SECRET'),
      jwtSecret: this.require('GATEWAY_JWT_SECRET'),
    };
  }

  jwtSecret(): string {
    return this.require('GATEWAY_JWT_SECRET');
  }

  publicBaseUrl(): string {
    let url = this.require('GATEWAY_PUBLIC_BASE_URL').trim();
    while (url.endsWith('/')) url = url.slice(0, -1);
    return url;
  }

  private require(key: string): string {
    const value = this.config.get<string>(key);
    if (!value || !value.trim()) {
      throw new ServiceUnavailableException({
        error: 'gateway_not_configured',
      });
    }
    return value;
  }
}
