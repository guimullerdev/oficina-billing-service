import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

import { CobrancaNaoEncontradaError } from '../application/errors/cobranca-nao-encontrada.error';

@Catch(CobrancaNaoEncontradaError)
export class CobrancaExceptionFilter implements ExceptionFilter {
  catch(exception: CobrancaNaoEncontradaError, host: ArgumentsHost): void {
    const statusCode = HttpStatus.NOT_FOUND;
    host.switchToHttp().getResponse<Response>().status(statusCode).json({
      statusCode,
      message: exception.message,
      error: exception.name,
    });
  }
}
