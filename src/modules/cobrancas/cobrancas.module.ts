import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';
import { MessageHandlerRegistry } from '../../shared/messaging/handlers/message-handler.registry';
import { MessagingModule } from '../../shared/messaging/messaging.module';
import { OutboxWriter } from '../../shared/messaging/outbox.writer';
import { AuthModule } from '../auth/auth.module';
import {
  ORCAMENTO_REPOSITORY,
  OrcamentoRepository,
} from '../orcamentos/domain/orcamento.repository';
import { PrismaOrcamentoRepository } from '../orcamentos/infrastructure/prisma-orcamento.repository';
import { CobrancaSolicitadaHandler } from './application/handlers/cobranca-solicitada.handler';
import {
  PAYMENT_GATEWAY,
  PaymentGateway,
} from './application/ports/payment-gateway.port';
import { GetCobrancaByOsUseCase } from './application/use-cases/get-cobranca-by-os.usecase';
import { ProcessarWebhookPagamentoUseCase } from './application/use-cases/processar-webhook-pagamento.usecase';
import { SolicitarCobrancaUseCase } from './application/use-cases/solicitar-cobranca.usecase';
import {
  COBRANCA_REPOSITORY,
  CobrancaRepository,
} from './domain/cobranca.repository';
import {
  HttpPaymentGateway,
  resolveGatewayBaseUrl,
} from './infrastructure/http-payment-gateway';
import { PrismaCobrancaRepository } from './infrastructure/prisma-cobranca.repository';
import { CobrancasController } from './presentation/cobrancas.controller';
import { WebhookPagamentoController } from './presentation/webhook-pagamento.controller';

@Module({
  imports: [AuthModule, MessagingModule],
  controllers: [CobrancasController, WebhookPagamentoController],
  providers: [
    // OutboxWriter é stateless e não é exportado pelo MessagingModule.
    OutboxWriter,
    { provide: COBRANCA_REPOSITORY, useClass: PrismaCobrancaRepository },
    // Leitura do orçamento pela porta do domínio de orçamentos (o
    // OrcamentosModule não exporta o repositório; a implementação é stateless).
    { provide: ORCAMENTO_REPOSITORY, useClass: PrismaOrcamentoRepository },
    {
      provide: PAYMENT_GATEWAY,
      useFactory: (config: ConfigService) =>
        new HttpPaymentGateway({
          baseUrl: resolveGatewayBaseUrl(
            config.get<string>('GATEWAY_INTERNAL_BASE_URL'),
          ),
          clientId: config.get<string>('GATEWAY_CLIENT_ID'),
          clientSecret: config.get<string>('GATEWAY_CLIENT_SECRET'),
        }),
      inject: [ConfigService],
    },
    {
      provide: GetCobrancaByOsUseCase,
      useFactory: (repo: CobrancaRepository) =>
        new GetCobrancaByOsUseCase(repo),
      inject: [COBRANCA_REPOSITORY],
    },
    {
      provide: SolicitarCobrancaUseCase,
      useFactory: (
        cobrancas: CobrancaRepository,
        orcamentos: OrcamentoRepository,
        gateway: PaymentGateway,
        outbox: OutboxWriter,
      ) => new SolicitarCobrancaUseCase(cobrancas, orcamentos, gateway, outbox),
      inject: [
        COBRANCA_REPOSITORY,
        ORCAMENTO_REPOSITORY,
        PAYMENT_GATEWAY,
        OutboxWriter,
      ],
    },
    {
      provide: ProcessarWebhookPagamentoUseCase,
      useFactory: (
        cobrancas: CobrancaRepository,
        gateway: PaymentGateway,
        prisma: PrismaService,
        outbox: OutboxWriter,
      ) =>
        new ProcessarWebhookPagamentoUseCase(
          cobrancas,
          gateway,
          prisma,
          outbox,
        ),
      inject: [
        COBRANCA_REPOSITORY,
        PAYMENT_GATEWAY,
        PrismaService,
        OutboxWriter,
      ],
    },
    {
      // Registra os handlers na criação dos providers, antes de o
      // SqsConsumerService iniciar (onModuleInit roda depois de todos os
      // providers da aplicação serem instanciados).
      provide: 'COBRANCAS_MESSAGE_HANDLERS',
      useFactory: (
        registry: MessageHandlerRegistry,
        solicitarCobranca: SolicitarCobrancaUseCase,
      ) => {
        const handlers = [new CobrancaSolicitadaHandler(solicitarCobranca)];
        handlers.forEach((h) => registry.register(h));
        return handlers;
      },
      inject: [MessageHandlerRegistry, SolicitarCobrancaUseCase],
    },
  ],
})
export class CobrancasModule {}
