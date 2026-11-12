import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';

import {
  renderCheckoutPage,
  renderNotFoundPage,
  renderResultPage,
} from './checkout-html';
import {
  CheckoutDecision,
  GatewayCheckoutService,
} from './gateway-checkout.service';

const HTML = 'text/html; charset=utf-8';

@ApiExcludeController()
@Controller('gateway/checkout')
export class GatewayCheckoutController {
  constructor(private readonly checkout: GatewayCheckoutService) {}

  @Get(':id')
  async page(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const payment = await this.checkout.find(id);
    if (!payment) return this.notFound(res);
    this.send(res, HttpStatus.OK, renderCheckoutPage(payment));
  }

  @Post(':id/aprovar')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    return this.decide(id, 'approved', res);
  }

  @Post(':id/recusar')
  @HttpCode(HttpStatus.OK)
  decline(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    return this.decide(id, 'declined', res);
  }

  private async decide(
    id: string,
    decision: CheckoutDecision,
    res: Response,
  ): Promise<void> {
    const outcome = await this.checkout.decide(id, decision);
    if (!outcome) return this.notFound(res);
    this.send(
      res,
      HttpStatus.OK,
      renderResultPage(outcome.payment, outcome.notificationFailed),
    );
  }

  private notFound(res: Response): void {
    this.send(res, HttpStatus.NOT_FOUND, renderNotFoundPage());
  }

  private send(res: Response, status: number, html: string): void {
    res.status(status).type(HTML).send(html);
  }
}
