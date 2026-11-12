import { Prisma } from '@prisma/client';

import {
  IncomingMessage,
  MessageHandler,
} from '../../../../shared/messaging/handlers/message-handler.interface';
import { TipoItemOrcamento } from '../../domain/orcamento.entity';
import {
  GerarOrcamentoInput,
  GerarOrcamentoUseCase,
  ItemOrcamentoInput,
} from '../use-cases/gerar-orcamento.usecase';

export const DIAGNOSTICO_CONCLUIDO = 'diagnostico.concluido';

/**
 * Payload inválido: o erro é relançado pelo IdempotentProcessor, a mensagem
 * não é removida da fila e, após as reentregas, vai para a DLQ.
 */
export class DiagnosticoConcluidoPayloadInvalidoError extends Error {
  constructor(motivo: string) {
    super(`Payload de diagnostico.concluido inválido: ${motivo}`);
    this.name = 'DiagnosticoConcluidoPayloadInvalidoError';
  }
}

type DiagnosticoConcluidoDados = Omit<
  GerarOrcamentoInput,
  'correlationId' | 'traceparent'
>;

const TIPOS_ITEM = new Set<string>(Object.values(TipoItemOrcamento));

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;

const isValorMonetario = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;

const invalido = (motivo: string): never => {
  throw new DiagnosticoConcluidoPayloadInvalidoError(motivo);
};

function parseItem(raw: unknown, index: number): ItemOrcamentoInput {
  const campo = (nome: string) => `itens[${index}].${nome}`;
  if (!isObject(raw)) return invalido(`itens[${index}] deve ser um objeto`);
  if (typeof raw.tipo !== 'string' || !TIPOS_ITEM.has(raw.tipo)) {
    return invalido(`${campo('tipo')} deve ser SERVICO ou PECA`);
  }
  if (!isNonEmptyString(raw.refId))
    return invalido(`${campo('refId')} ausente`);
  if (typeof raw.descricao !== 'string') {
    return invalido(`${campo('descricao')} deve ser texto`);
  }
  if (
    typeof raw.quantidade !== 'number' ||
    !Number.isInteger(raw.quantidade) ||
    raw.quantidade <= 0
  ) {
    return invalido(`${campo('quantidade')} deve ser um inteiro positivo`);
  }
  if (!isValorMonetario(raw.precoUnitario)) {
    return invalido(`${campo('precoUnitario')} deve ser um número >= 0`);
  }
  return {
    tipo: raw.tipo as TipoItemOrcamento,
    refId: raw.refId,
    descricao: raw.descricao,
    quantidade: raw.quantidade,
    precoUnitario: raw.precoUnitario,
  };
}

/**
 * Aceita os dois formatos publicados pelo os-service:
 * - antigo: `{ id, status }`
 * - novo: `{ id, osId, status, clienteId, itens[], valorTotal }`
 * `osId = payload.osId ?? payload.id`.
 */
export function parseDiagnosticoConcluido(
  payload: unknown,
): DiagnosticoConcluidoDados {
  if (!isObject(payload)) return invalido('payload deve ser um objeto');

  const osId = payload.osId ?? payload.id;
  if (!isNonEmptyString(osId)) return invalido('osId/id ausente');

  const clienteId = payload.clienteId ?? undefined;
  if (clienteId !== undefined && !isNonEmptyString(clienteId)) {
    return invalido('clienteId deve ser texto não vazio');
  }

  const rawItens = payload.itens ?? undefined;
  if (rawItens !== undefined && !Array.isArray(rawItens)) {
    return invalido('itens deve ser uma lista');
  }

  const valorTotal = payload.valorTotal ?? undefined;
  if (valorTotal !== undefined && !isValorMonetario(valorTotal)) {
    return invalido('valorTotal deve ser um número >= 0');
  }

  return {
    osId,
    clienteId,
    itens: rawItens?.map(parseItem),
    valorTotal,
  };
}

export class DiagnosticoConcluidoHandler implements MessageHandler {
  readonly evento = DIAGNOSTICO_CONCLUIDO;

  constructor(private readonly gerarOrcamento: GerarOrcamentoUseCase) {}

  async handle(message: IncomingMessage, tx?: unknown): Promise<void> {
    if (!tx) {
      throw new Error(
        'diagnostico.concluido exige a transação do IdempotentProcessor',
      );
    }
    const dados = parseDiagnosticoConcluido(message.payload);
    await this.gerarOrcamento.execute(
      {
        ...dados,
        correlationId: message.correlationId,
        traceparent: message.traceparent,
      },
      tx as Prisma.TransactionClient,
    );
  }
}
