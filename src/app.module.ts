import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { FakeGatewayModule } from './fake-gateway/fake-gateway.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { OrcamentosModule } from './modules/orcamentos/orcamentos.module';
import { MessagingModule } from './shared/messaging/messaging.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    HealthModule,
    MessagingModule,
    OrcamentosModule,
    FakeGatewayModule,
  ],
})
export class AppModule {}
