import { Injectable } from '@nestjs/common';
import { FakeGatewayPagamento } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { WebhookNotifier } from './webhook-notifier.service';

export type CheckoutDecision = 'approved' | 'declined';

export interface CheckoutOutcome {
  payment: FakeGatewayPagamento;
  notificationFailed: boolean;
}

@Injectable()
export class GatewayCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: WebhookNotifier,
  ) {}

  find(id: string): Promise<FakeGatewayPagamento | null> {
    return this.prisma.fakeGatewayPagamento.findUnique({ where: { id } });
  }

  /** Returns null when the payment does not exist. */
  async decide(
    id: string,
    decision: CheckoutDecision,
  ): Promise<CheckoutOutcome | null> {
    const current = await this.find(id);
    if (!current) return null;
    if (current.status !== 'pending') {
      return { payment: current, notificationFailed: false };
    }

    // Conditional update: only one concurrent request wins the transition.
    const { count } = await this.prisma.fakeGatewayPagamento.updateMany({
      where: { id, status: 'pending' },
      data: { status: decision },
    });
    if (count === 0) {
      const latest = await this.find(id);
      return latest ? { payment: latest, notificationFailed: false } : null;
    }

    const payment = { ...current, status: decision };
    const result = await this.notifier.notify({
      payment_id: payment.id,
      status: decision,
      amount_cents: payment.amountCents,
      currency: payment.currency,
      metadata: payment.metadata,
      occurred_at: new Date().toISOString(),
    });
    return { payment, notificationFailed: !result.delivered };
  }
}
