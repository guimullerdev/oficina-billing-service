import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';

import { LOG_ONLY_EVENTOS, LogOnlyHandler } from './handlers/log-only.handler';
import { MessageHandlerRegistry } from './handlers/message-handler.registry';
import { IdempotentProcessor } from './idempotency/idempotent-processor';
import { OutboxPublisher } from './outbox.publisher';
import { SqsConsumerService } from './sqs/sqs-consumer.service';

@Module({
  providers: [
    {
      provide: SNSClient,
      // O endpoint (LocalStack) vem de AWS_ENDPOINT_URL, lido pelo próprio SDK.
      useFactory: (config: ConfigService) =>
        new SNSClient({ region: config.get<string>('AWS_REGION') }),
      inject: [ConfigService],
    },
    {
      provide: SQSClient,
      // O endpoint (LocalStack) vem de AWS_ENDPOINT_URL, lido pelo próprio SDK.
      useFactory: (config: ConfigService) =>
        new SQSClient({ region: config.get<string>('AWS_REGION') }),
      inject: [ConfigService],
    },
    {
      provide: MessageHandlerRegistry,
      // Os handlers são registrados na criação (provider abaixo), antes de o
      // consumidor iniciar (os onModuleInit rodam depois de todos os providers
      // serem criados).
      useFactory: () => new MessageHandlerRegistry(),
    },
    {
      // Provisório: as Fases 5/7 substituem pelos handlers reais.
      provide: 'LOG_ONLY_HANDLERS',
      useFactory: (registry: MessageHandlerRegistry) => {
        const handlers = LOG_ONLY_EVENTOS.map((e) => new LogOnlyHandler(e));
        handlers.forEach((h) => registry.register(h));
        return handlers;
      },
      inject: [MessageHandlerRegistry],
    },
    OutboxPublisher,
    IdempotentProcessor,
    SqsConsumerService,
  ],
  exports: [MessageHandlerRegistry],
})
export class MessagingModule {}
