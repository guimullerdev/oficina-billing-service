import {
  CriarPagamentoInput,
  GatewayPayment,
  GatewayPaymentStatus,
  PaymentGateway,
  PaymentGatewayConflictError,
  PaymentGatewayError,
  PaymentGatewayUnavailableError,
} from '../application/ports/payment-gateway.port';

export const DEFAULT_GATEWAY_BASE_URL = 'http://localhost:3000/gateway';
const DEFAULT_TIMEOUT_MS = 5_000;
/** O token é renovado 30s antes de expirar. */
const TOKEN_EXPIRY_MARGIN_MS = 30_000;

export function resolveGatewayBaseUrl(raw: string | undefined): string {
  const value = raw?.trim();
  return value ? value.replace(/\/+$/, '') : DEFAULT_GATEWAY_BASE_URL;
}

export interface HttpPaymentGatewayOptions {
  /** Sem barra final (ver resolveGatewayBaseUrl). */
  baseUrl: string;
  clientId?: string;
  clientSecret?: string;
  timeoutMs?: number;
  /** Padrão: `fetch` global. */
  fetchFn?: FetchFn;
  now?: () => number;
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

interface CachedToken {
  value: string;
  refreshAt: number;
}

interface RawResponse {
  status: number;
  body: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const PAYMENT_STATUSES = new Set<string>(['pending', 'approved', 'declined']);

/**
 * Adapter HTTP do gateway de pagamentos (contrato do gateway simulado em
 * /gateway). Autentica via OAuth2 client_credentials, mantém o token em cache
 * até 30s antes de expirar e, se uma chamada de negócio receber 401, descarta
 * o token, obtém outro e repete a chamada uma única vez.
 */
export class HttpPaymentGateway implements PaymentGateway {
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchFn;
  private readonly now: () => number;
  private token: CachedToken | null = null;
  private tokenInFlight: Promise<string> | null = null;

  constructor(private readonly options: HttpPaymentGatewayOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? Date.now;
  }

  async criarPagamento(input: CriarPagamentoInput): Promise<GatewayPayment> {
    const res = await this.authorized('/payments', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify({
        amount_cents: input.amountCents,
        currency: input.currency,
        description: input.description,
        metadata: input.metadata,
      }),
    });
    return toGatewayPayment(res.body);
  }

  async consultarPagamento(id: string): Promise<GatewayPayment> {
    const res = await this.authorized(`/payments/${encodeURIComponent(id)}`, {
      method: 'GET',
    });
    return toGatewayPayment(res.body);
  }

  private async authorized(
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
  ): Promise<RawResponse> {
    const send = async (token: string) =>
      this.send(path, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${token}` },
      });

    let token = await this.getToken();
    let res = await send(token);
    if (res.status === 401) {
      this.invalidate(token);
      token = await this.getToken();
      res = await send(token);
    }
    if (res.status >= 200 && res.status < 300) return res;
    throw errorFor(res, `${init.method} ${path}`);
  }

  private async getToken(): Promise<string> {
    if (this.token && this.now() < this.token.refreshAt) {
      return this.token.value;
    }
    // Uma única requisição de token em voo: chamadas concorrentes aguardam a
    // mesma promise em vez de disparar várias (stampede).
    this.tokenInFlight ??= this.fetchToken().finally(() => {
      this.tokenInFlight = null;
    });
    return this.tokenInFlight;
  }

  private invalidate(token: string): void {
    if (this.token?.value === token) this.token = null;
  }

  private async fetchToken(): Promise<string> {
    const { clientId, clientSecret } = this.options;
    if (!clientId || !clientSecret) {
      throw new PaymentGatewayUnavailableError(
        'Gateway não configurado (GATEWAY_CLIENT_ID/GATEWAY_CLIENT_SECRET)',
      );
    }
    const res = await this.send('/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    if (res.status !== 200) throw errorFor(res, 'POST /oauth/token');

    const body = res.body;
    if (!isObject(body) || typeof body.access_token !== 'string') {
      throw new PaymentGatewayError('Resposta de token inválida do gateway');
    }
    const expiresInMs =
      typeof body.expires_in === 'number' ? body.expires_in * 1000 : 0;
    this.token = {
      value: body.access_token,
      refreshAt: this.now() + expiresInMs - TOKEN_EXPIRY_MARGIN_MS,
    };
    return body.access_token;
  }

  /** Executa a requisição com timeout (AbortController), incluindo o corpo. */
  private async send(
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: string },
  ): Promise<RawResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchFn(`${this.options.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
      });
      const text = await res.text();
      return { status: res.status, body: parseJson(text) };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new PaymentGatewayUnavailableError(
          `Timeout após ${this.timeoutMs}ms em ${init.method} ${path}`,
        );
      }
      throw new PaymentGatewayUnavailableError(
        `Falha de rede em ${init.method} ${path}: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorFor(res: RawResponse, operation: string): PaymentGatewayError {
  const detail =
    isObject(res.body) && typeof res.body.error === 'string'
      ? ` (${res.body.error})`
      : '';
  const message = `Gateway respondeu ${res.status} em ${operation}${detail}`;
  if (res.status === 409) return new PaymentGatewayConflictError(message);
  if (res.status >= 500) {
    return new PaymentGatewayUnavailableError(message, res.status);
  }
  return new PaymentGatewayError(message, res.status);
}

function toGatewayPayment(body: unknown): GatewayPayment {
  if (
    !isObject(body) ||
    typeof body.id !== 'string' ||
    typeof body.status !== 'string' ||
    !PAYMENT_STATUSES.has(body.status) ||
    typeof body.amount_cents !== 'number' ||
    typeof body.currency !== 'string' ||
    typeof body.checkout_url !== 'string'
  ) {
    throw new PaymentGatewayError('Resposta de pagamento inválida do gateway');
  }
  return {
    id: body.id,
    status: body.status as GatewayPaymentStatus,
    amountCents: body.amount_cents,
    currency: body.currency,
    checkoutUrl: body.checkout_url,
    metadata: isObject(body.metadata) ? body.metadata : null,
  };
}
