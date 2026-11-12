export enum StatusCobranca {
  PENDENTE = 'PENDENTE',
  CONFIRMADA = 'CONFIRMADA',
  RECUSADA = 'RECUSADA',
}

export interface CobrancaProps {
  id: string;
  osId: string;
  orcamentoId?: string;
  gatewayPaymentId?: string;
  /** Valor em reais, com 2 casas decimais. */
  valor: number;
  status: StatusCobranca;
  checkoutUrl?: string;
  correlationId?: string;
  sagaId?: string;
  motivo?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface NovaCobrancaBase {
  osId: string;
  orcamentoId?: string;
  valor: number;
  correlationId?: string;
  sagaId?: string;
}

export interface NovaCobrancaPendente extends NovaCobrancaBase {
  orcamentoId: string;
  gatewayPaymentId: string;
  checkoutUrl: string;
}

export interface NovaCobrancaRecusada extends NovaCobrancaBase {
  motivo: string;
}

function normalizarValor(valor: number): number {
  if (!Number.isFinite(valor) || valor < 0) {
    throw new Error('Valor da cobrança deve ser um número finito >= 0');
  }
  return Math.round(valor * 100) / 100;
}

export class Cobranca {
  private constructor(private readonly props: CobrancaProps) {}

  /** Cobrança aberta no gateway, aguardando o pagamento do cliente. */
  static pendente(input: NovaCobrancaPendente): Cobranca {
    return Cobranca.nova(input, StatusCobranca.PENDENTE);
  }

  /**
   * Cobrança recusada antes de chegar ao gateway. Fica gravada para que uma
   * reentrega de `os.cobranca.solicitada` (outro eventId) seja no-op.
   */
  static recusada(input: NovaCobrancaRecusada): Cobranca {
    return Cobranca.nova(input, StatusCobranca.RECUSADA);
  }

  static restore(props: CobrancaProps): Cobranca {
    return new Cobranca(props);
  }

  private static nova(
    input: NovaCobrancaBase &
      Partial<
        Pick<CobrancaProps, 'gatewayPaymentId' | 'checkoutUrl' | 'motivo'>
      >,
    status: StatusCobranca,
  ): Cobranca {
    const now = new Date();
    return new Cobranca({
      ...input,
      id: crypto.randomUUID(),
      valor: normalizarValor(input.valor),
      status,
      createdAt: now,
      updatedAt: now,
    });
  }

  get id(): string {
    return this.props.id;
  }
  get osId(): string {
    return this.props.osId;
  }
  get orcamentoId(): string | undefined {
    return this.props.orcamentoId;
  }
  get gatewayPaymentId(): string | undefined {
    return this.props.gatewayPaymentId;
  }
  get valor(): number {
    return this.props.valor;
  }
  get status(): StatusCobranca {
    return this.props.status;
  }
  get checkoutUrl(): string | undefined {
    return this.props.checkoutUrl;
  }
  get correlationId(): string | undefined {
    return this.props.correlationId;
  }
  get sagaId(): string | undefined {
    return this.props.sagaId;
  }
  get motivo(): string | undefined {
    return this.props.motivo;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
