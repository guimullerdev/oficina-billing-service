import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

import { OrcamentoNaoEncontradoError } from '../application/errors/orcamento-nao-encontrado.error';
import { OrcamentoTransicaoInvalidaError } from '../domain/orcamento.entity';

@Catch(OrcamentoNaoEncontradoError, OrcamentoTransicaoInvalidaError)
export class OrcamentoExceptionFilter implements ExceptionFilter {
  catch(
    exception: OrcamentoNaoEncontradoError | OrcamentoTransicaoInvalidaError,
    host: ArgumentsHost,
  ): void {
    const statusCode =
      exception instanceof OrcamentoNaoEncontradoError
        ? HttpStatus.NOT_FOUND
        : HttpStatus.CONFLICT;
    host.switchToHttp().getResponse<Response>().status(statusCode).json({
      statusCode,
      message: exception.message,
      error: exception.name,
    });
  }
}
