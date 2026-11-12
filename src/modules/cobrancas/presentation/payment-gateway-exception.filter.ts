import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

import {
  PaymentGatewayError,
  PaymentGatewayUnavailableError,
} from '../application/ports/payment-gateway.port';

/**
 * Falhas ao consultar o gateway: 503 quando transitória (o chamador pode
 * tentar de novo), 502 para respostas inesperadas. O detalhe fica no log.
 */
@Catch(PaymentGatewayError)
export class PaymentGatewayExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PaymentGatewayExceptionFilter.name);

  catch(exception: PaymentGatewayError, host: ArgumentsHost): void {
    const indisponivel = exception instanceof PaymentGatewayUnavailableError;
    const statusCode = indisponivel
      ? HttpStatus.SERVICE_UNAVAILABLE
      : HttpStatus.BAD_GATEWAY;
    this.logger.warn(`Falha ao consultar o gateway: ${exception.message}`);
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(statusCode)
      .json({
        statusCode,
        message: indisponivel
          ? 'Gateway de pagamentos indisponível'
          : 'Resposta inesperada do gateway de pagamentos',
        error: exception.name,
      });
  }
}
