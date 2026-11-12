import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
  UseFilters,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';

import { Public } from '../../auth/decorators/public.decorator';
import {
  ProcessarWebhookPagamentoUseCase,
  WebhookPagamentoResult,
} from '../application/use-cases/processar-webhook-pagamento.usecase';
import { verifyWebhookSignature } from '../application/webhook-signature';
import { CobrancaExceptionFilter } from './cobranca-exception.filter';
import { PaymentGatewayExceptionFilter } from './payment-gateway-exception.filter';

interface WebhookPagamentoPayload {
  paymentId: string;
  status?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const header = (req: Request, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
};

function parsePayload(rawBody: Buffer): WebhookPagamentoPayload {
  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new BadRequestException('Corpo do webhook não é um JSON válido');
  }
  if (
    !isObject(body) ||
    typeof body.payment_id !== 'string' ||
    body.payment_id.trim() === ''
  ) {
    throw new BadRequestException('payment_id é obrigatório');
  }
  return {
    paymentId: body.payment_id,
    status: typeof body.status === 'string' ? body.status : undefined,
  };
}

/**
 * Webhook do gateway de pagamentos. Público (autenticado pela assinatura
 * HMAC, não por JWT) e fora da validação de DTO: a assinatura é verificada
 * sobre o corpo bruto (`rawBody: true` em main.ts) antes de qualquer parse.
 */
@ApiTags('webhooks')
@Public()
@UseFilters(CobrancaExceptionFilter, PaymentGatewayExceptionFilter)
@Controller('webhooks')
export class WebhookPagamentoController {
  private readonly logger = new Logger(WebhookPagamentoController.name);

  constructor(
    private readonly processarWebhook: ProcessarWebhookPagamentoUseCase,
    private readonly config: ConfigService,
  ) {}

  @Post('pagamento')
  @HttpCode(HttpStatus.OK)
  @ApiHeader({
    name: 'x-signature',
    description: 'hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`))',
  })
  @ApiHeader({
    name: 'x-signature-timestamp',
    description: 'Segundos unix',
  })
  @ApiOkResponse({ description: 'Webhook processado (ou já processado)' })
  @ApiBadRequestResponse({ description: 'Corpo inválido' })
  @ApiUnauthorizedResponse({ description: 'Assinatura inválida' })
  @ApiNotFoundResponse({ description: 'Cobrança não encontrada' })
  @ApiServiceUnavailableResponse({ description: 'Gateway indisponível' })
  async receber(
    @Req() req: RawBodyRequest<Request>,
  ): Promise<WebhookPagamentoResult> {
    // Sem parser compatível (content-type não JSON/form) não há rawBody: a
    // assinatura é verificada sobre um corpo vazio e falha.
    const rawBody = req.rawBody ?? Buffer.alloc(0);
    this.verificarAssinatura(req, rawBody);
    const payload = parsePayload(rawBody);
    return this.processarWebhook.execute(payload.paymentId, payload.status);
  }

  private verificarAssinatura(req: Request, rawBody: Buffer): void {
    const result = verifyWebhookSignature(
      rawBody,
      header(req, 'x-signature'),
      header(req, 'x-signature-timestamp'),
      this.config.get<string>('PAYMENT_WEBHOOK_SECRET'),
      Math.floor(Date.now() / 1000),
    );
    if (result.ok) return;

    if (result.reason === 'missing_secret') {
      this.logger.error(
        'PAYMENT_WEBHOOK_SECRET não configurado; webhook de pagamento rejeitado',
      );
    } else {
      this.logger.warn(
        `Webhook de pagamento com assinatura inválida: ${result.reason}`,
      );
    }
    throw new UnauthorizedException('Assinatura do webhook inválida');
  }
}
