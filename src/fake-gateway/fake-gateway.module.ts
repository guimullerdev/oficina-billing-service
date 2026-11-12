import { Module } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { GatewayAuthGuard } from './auth/gateway-auth.guard';
import { GATEWAY_JWT_SERVICE } from './fake-gateway.constants';
import { GatewayCheckoutController } from './checkout/gateway-checkout.controller';
import { GatewayCheckoutService } from './checkout/gateway-checkout.service';
import { WebhookNotifier } from './checkout/webhook-notifier.service';
import { GatewayConfigService } from './gateway-config.service';
import { GatewayOAuthController } from './oauth/gateway-oauth.controller';
import { GatewayTokenService } from './oauth/gateway-token.service';
import { GatewayPaymentsController } from './payments/gateway-payments.controller';
import { GatewayPaymentsService } from './payments/gateway-payments.service';

/**
 * Simulated third-party payment gateway, served under /gateway (outside the
 * /billing prefix). Owns its own JwtService instance so its tokens never mix
 * with the billing user tokens. Depends only on PrismaModule (global).
 */
@Module({
  controllers: [
    GatewayOAuthController,
    GatewayPaymentsController,
    GatewayCheckoutController,
  ],
  providers: [
    { provide: GATEWAY_JWT_SERVICE, useFactory: () => new JwtService({}) },
    GatewayConfigService,
    GatewayTokenService,
    GatewayAuthGuard,
    GatewayPaymentsService,
    GatewayCheckoutService,
    WebhookNotifier,
  ],
})
export class FakeGatewayModule {}
