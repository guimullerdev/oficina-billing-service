import { FakeGatewayPagamento, Prisma } from '@prisma/client';

export interface GatewayPaymentResponse {
  id: string;
  status: FakeGatewayPagamento['status'];
  amount_cents: number;
  currency: string;
  description: string | null;
  metadata: Prisma.JsonValue | null;
  checkout_url: string;
  created_at: string;
}

/** @param publicBaseUrl base URL without trailing slash */
export function toGatewayPaymentResponse(
  payment: FakeGatewayPagamento,
  publicBaseUrl: string,
): GatewayPaymentResponse {
  return {
    id: payment.id,
    status: payment.status,
    amount_cents: payment.amountCents,
    currency: payment.currency,
    description: payment.description,
    metadata: payment.metadata,
    checkout_url: `${publicBaseUrl}/gateway/checkout/${payment.id}`,
    created_at: payment.createdAt.toISOString(),
  };
}
