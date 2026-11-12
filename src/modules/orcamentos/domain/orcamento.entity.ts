import { Dinheiro } from './dinheiro.vo';

export enum StatusOrcamento {
  GERADO = 'GERADO',
  APROVADO = 'APROVADO',
  REPROVADO = 'REPROVADO',
}

export class OrcamentoTransicaoInvalidaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrcamentoTransicaoInvalidaError';
  }
}

export interface OrcamentoProps {
  id: string;
  osId: string;
  clienteId?: string;
  status: StatusOrcamento;
  valorTotal: Dinheiro;
  motivoReprovacao?: string;
  correlationId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class Orcamento {
  private constructor(private readonly props: OrcamentoProps) {}

  static create(input: {
    osId: string;
    clienteId?: string;
    valorTotal: Dinheiro;
    correlationId?: string;
  }): Orcamento {
    const now = new Date();
    return new Orcamento({
      id: crypto.randomUUID(),
      osId: input.osId,
      clienteId: input.clienteId,
      status: StatusOrcamento.GERADO,
      valorTotal: input.valorTotal,
      correlationId: input.correlationId,
      createdAt: now,
      updatedAt: now,
    });
  }

  static restore(props: OrcamentoProps): Orcamento {
    return new Orcamento({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get osId(): string {
    return this.props.osId;
  }
  get clienteId(): string | undefined {
    return this.props.clienteId;
  }
  get status(): StatusOrcamento {
    return this.props.status;
  }
  get valorTotal(): Dinheiro {
    return this.props.valorTotal;
  }
  get motivoReprovacao(): string | undefined {
    return this.props.motivoReprovacao;
  }
  get correlationId(): string | undefined {
    return this.props.correlationId;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  aprovar(): Orcamento {
    this.assertGerado(StatusOrcamento.APROVADO);
    return new Orcamento({
      ...this.props,
      status: StatusOrcamento.APROVADO,
      updatedAt: new Date(),
    });
  }

  reprovar(motivo: string): Orcamento {
    this.assertGerado(StatusOrcamento.REPROVADO);
    if (!motivo || motivo.trim().length === 0) {
      throw new Error('Motivo da reprovação é obrigatório');
    }
    return new Orcamento({
      ...this.props,
      status: StatusOrcamento.REPROVADO,
      motivoReprovacao: motivo.trim(),
      updatedAt: new Date(),
    });
  }

  private assertGerado(destino: StatusOrcamento): void {
    if (this.props.status !== StatusOrcamento.GERADO) {
      throw new OrcamentoTransicaoInvalidaError(
        `Transição inválida: ${this.props.status} → ${destino}. Status esperado: GERADO`,
      );
    }
  }
}
