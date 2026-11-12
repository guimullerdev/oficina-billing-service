import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FakeGatewayPagamento, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface CreateGatewayPaymentInput {
  idempotencyKey: string;
  clientId: string;
  amountCents: number;
  currency: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateGatewayPaymentResult {
  payment: FakeGatewayPagamento;
  created: boolean;
}

@Injectable()
export class GatewayPaymentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotent by Idempotency-Key: a replay with the same request returns the
   * stored payment; a different request under the same key is a conflict.
   */
  async create(
    input: CreateGatewayPaymentInput,
  ): Promise<CreateGatewayPaymentResult> {
    const existing = await this.findByKey(input.idempotencyKey);
    if (existing) return this.replay(existing, input);

    try {
      const payment = await this.prisma.fakeGatewayPagamento.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          clientId: input.clientId,
          amountCents: input.amountCents,
          currency: input.currency,
          description: input.description ?? null,
          metadata: input.metadata as Prisma.InputJsonObject | undefined,
        },
      });
      return { payment, created: true };
    } catch (err) {
      // Lost a race against a concurrent request with the same key.
      if (!isUniqueViolation(err)) throw err;
      const winner = await this.findByKey(input.idempotencyKey);
      if (!winner) throw err;
      return this.replay(winner, input);
    }
  }

  async findById(id: string, clientId: string): Promise<FakeGatewayPagamento> {
    const payment = await this.prisma.fakeGatewayPagamento.findUnique({
      where: { id },
    });
    if (!payment || payment.clientId !== clientId) {
      throw new NotFoundException({ error: 'payment_not_found' });
    }
    return payment;
  }

  private findByKey(idempotencyKey: string) {
    return this.prisma.fakeGatewayPagamento.findUnique({
      where: { idempotencyKey },
    });
  }

  private replay(
    payment: FakeGatewayPagamento,
    input: CreateGatewayPaymentInput,
  ): CreateGatewayPaymentResult {
    const sameRequest =
      payment.clientId === input.clientId &&
      payment.amountCents === input.amountCents &&
      payment.currency === input.currency;
    if (!sameRequest) {
      throw new ConflictException({ error: 'idempotency_key_conflict' });
    }
    return { payment, created: false };
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}
