export type GatewayPaymentStatus = 'pending' | 'approved' | 'declined';

export interface CriarPagamentoInput {
  /** Repetir a mesma chave devolve o mesmo pagamento (replay idempotente). */
  idempotencyKey: string;
  amountCents: number;
  currency: string;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface GatewayPayment {
  id: string;
  status: GatewayPaymentStatus;
  amountCents: number;
  currency: string;
  checkoutUrl: string;
  metadata: Record<string, unknown> | null;
}

/** Porta para o provedor de pagamentos (hoje, o gateway simulado em /gateway). */
export interface PaymentGateway {
  criarPagamento(input: CriarPagamentoInput): Promise<GatewayPayment>;
  consultarPagamento(id: string): Promise<GatewayPayment>;
}

export const PAYMENT_GATEWAY = Symbol('PaymentGateway');

/** Falha do gateway sem tratamento específico (4xx, resposta inválida...). */
export class PaymentGatewayError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PaymentGatewayError';
  }
}

/** 409: mesma Idempotency-Key com corpo diferente. */
export class PaymentGatewayConflictError extends PaymentGatewayError {
  constructor(message: string) {
    super(message, 409);
    this.name = 'PaymentGatewayConflictError';
  }
}

/** 5xx, timeout, erro de rede ou gateway não configurado: transitório. */
export class PaymentGatewayUnavailableError extends PaymentGatewayError {
  constructor(message: string, status?: number) {
    super(message, status);
    this.name = 'PaymentGatewayUnavailableError';
  }
}
