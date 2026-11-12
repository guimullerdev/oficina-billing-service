import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';

import { GATEWAY_DEFAULT_CURRENCY } from '../fake-gateway.constants';
import { GatewayConfigService } from '../gateway-config.service';
import { GatewayAuthGuard } from '../auth/gateway-auth.guard';
import type { GatewayRequest } from '../auth/gateway-auth.guard';
import { CreateGatewayPaymentDto } from './dto/create-gateway-payment.dto';
import {
  GatewayPaymentResponse,
  toGatewayPaymentResponse,
} from './gateway-payment.response';
import { GatewayPaymentsService } from './gateway-payments.service';

const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

@ApiTags('fake-gateway')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Token do gateway ausente/inválido' })
@ApiServiceUnavailableResponse({ description: 'gateway_not_configured' })
@UseGuards(GatewayAuthGuard)
@Controller('gateway/payments')
export class GatewayPaymentsController {
  constructor(
    private readonly payments: GatewayPaymentsService,
    private readonly config: GatewayConfigService,
  ) {}

  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ description: 'Pagamento criado (pending)' })
  @ApiOkResponse({ description: 'Replay idempotente: pagamento existente' })
  @ApiBadRequestResponse({ description: 'Idempotency-Key ou corpo inválido' })
  @ApiConflictResponse({ description: 'idempotency_key_conflict' })
  async create(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateGatewayPaymentDto,
    @Req() req: GatewayRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GatewayPaymentResponse> {
    const key = idempotencyKey?.trim();
    if (!key) {
      throw new BadRequestException({ error: 'idempotency_key_required' });
    }
    if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new BadRequestException({ error: 'invalid_idempotency_key' });
    }
    // Resolved before writing so a misconfigured gateway never persists.
    const publicBaseUrl = this.config.publicBaseUrl();

    const { payment, created } = await this.payments.create({
      idempotencyKey: key,
      clientId: clientOf(req),
      amountCents: dto.amount_cents,
      currency: dto.currency ?? GATEWAY_DEFAULT_CURRENCY,
      description: dto.description,
      metadata: dto.metadata,
    });

    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return toGatewayPaymentResponse(payment, publicBaseUrl);
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Pagamento' })
  @ApiNotFoundResponse({ description: 'payment_not_found' })
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: GatewayRequest,
  ): Promise<GatewayPaymentResponse> {
    const publicBaseUrl = this.config.publicBaseUrl();
    const payment = await this.payments.findById(id, clientOf(req));
    return toGatewayPaymentResponse(payment, publicBaseUrl);
  }
}

function clientOf(req: GatewayRequest): string {
  const clientId = req.gatewayClient?.clientId;
  if (!clientId) throw new UnauthorizedException({ error: 'invalid_token' });
  return clientId;
}
