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

export enum TipoItemOrcamento {
  SERVICO = 'SERVICO',
  PECA = 'PECA',
}

/** Item do orçamento: snapshot do diagnóstico, nunca alterado depois. */
export interface OrcamentoItem {
  readonly id: string;
  readonly tipo: TipoItemOrcamento;
  readonly refId: string;
  readonly descricao: string;
  readonly quantidade: number;
  readonly precoUnitario: Dinheiro;
}

export type NovoOrcamentoItem = Omit<OrcamentoItem, 'id'>;

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
  itens?: readonly OrcamentoItem[];
}

const congelarItens = (
  itens: readonly OrcamentoItem[] = [],
): readonly OrcamentoItem[] =>
  Object.freeze(itens.map((item) => Object.freeze({ ...item })));

export class Orcamento {
  private readonly props: OrcamentoProps & {
    itens: readonly OrcamentoItem[];
  };

  private constructor(props: OrcamentoProps) {
    this.props = { ...props, itens: congelarItens(props.itens) };
  }

  static create(input: {
    osId: string;
    clienteId?: string;
    valorTotal: Dinheiro;
    correlationId?: string;
    itens?: readonly NovoOrcamentoItem[];
  }): Orcamento {
    const itens = (input.itens ?? []).map((item) => {
      if (!Number.isInteger(item.quantidade) || item.quantidade <= 0) {
        throw new Error('Quantidade do item deve ser um inteiro positivo');
      }
      return { ...item, id: crypto.randomUUID() };
    });
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
      itens,
    });
  }

  static restore(props: OrcamentoProps): Orcamento {
    return new Orcamento(props);
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
  get itens(): readonly OrcamentoItem[] {
    return this.props.itens;
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
