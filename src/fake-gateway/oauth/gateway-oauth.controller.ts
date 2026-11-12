import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { extractClientCredentials } from './client-credentials';
import {
  GatewayTokenResponse,
  GatewayTokenService,
} from './gateway-token.service';

@ApiTags('fake-gateway')
@Controller('gateway/oauth')
export class GatewayOAuthController {
  constructor(private readonly tokens: GatewayTokenService) {}

  /**
   * OAuth2 client_credentials grant. The body is read as a plain object (no
   * DTO) so the global ValidationPipe does not replace OAuth error bodies.
   */
  @Post('token')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiConsumes('application/x-www-form-urlencoded', 'application/json')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['grant_type'],
      properties: {
        grant_type: { type: 'string', example: 'client_credentials' },
        client_id: { type: 'string' },
        client_secret: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ description: 'Access token (Bearer, 300s)' })
  @ApiBadRequestResponse({ description: 'unsupported_grant_type' })
  @ApiUnauthorizedResponse({ description: 'invalid_client' })
  @ApiServiceUnavailableResponse({ description: 'gateway_not_configured' })
  token(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: Record<string, unknown> | undefined,
  ): Promise<GatewayTokenResponse> {
    return this.tokens.issue(
      body?.grant_type,
      extractClientCredentials(authorization, body),
    );
  }
}
