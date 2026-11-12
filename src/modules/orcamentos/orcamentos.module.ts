import { Module } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { OutboxWriter } from '../../shared/messaging/outbox.writer';
import { AuthModule } from '../auth/auth.module';
import { AprovarOrcamentoUseCase } from './application/use-cases/aprovar-orcamento.usecase';
import { GetOrcamentoByOsUseCase } from './application/use-cases/get-orcamento-by-os.usecase';
import { GetOrcamentoUseCase } from './application/use-cases/get-orcamento.usecase';
import { ReprovarOrcamentoUseCase } from './application/use-cases/reprovar-orcamento.usecase';
import {
  ORCAMENTO_REPOSITORY,
  OrcamentoRepository,
} from './domain/orcamento.repository';
import { PrismaOrcamentoRepository } from './infrastructure/prisma-orcamento.repository';
import { OrcamentosController } from './presentation/orcamentos.controller';

@Module({
  imports: [AuthModule],
  controllers: [OrcamentosController],
  providers: [
    // OutboxWriter é stateless e não é exportado pelo MessagingModule.
    OutboxWriter,
    { provide: ORCAMENTO_REPOSITORY, useClass: PrismaOrcamentoRepository },
    {
      provide: GetOrcamentoUseCase,
      useFactory: (repo: OrcamentoRepository) => new GetOrcamentoUseCase(repo),
      inject: [ORCAMENTO_REPOSITORY],
    },
    {
      provide: GetOrcamentoByOsUseCase,
      useFactory: (repo: OrcamentoRepository) =>
        new GetOrcamentoByOsUseCase(repo),
      inject: [ORCAMENTO_REPOSITORY],
    },
    {
      provide: AprovarOrcamentoUseCase,
      useFactory: (
        repo: OrcamentoRepository,
        prisma: PrismaService,
        outbox: OutboxWriter,
      ) => new AprovarOrcamentoUseCase(repo, prisma, outbox),
      inject: [ORCAMENTO_REPOSITORY, PrismaService, OutboxWriter],
    },
    {
      provide: ReprovarOrcamentoUseCase,
      useFactory: (
        repo: OrcamentoRepository,
        prisma: PrismaService,
        outbox: OutboxWriter,
      ) => new ReprovarOrcamentoUseCase(repo, prisma, outbox),
      inject: [ORCAMENTO_REPOSITORY, PrismaService, OutboxWriter],
    },
  ],
})
export class OrcamentosModule {}
