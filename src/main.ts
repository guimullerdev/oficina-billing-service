import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Gateway webhooks (e.g. payment provider callbacks) stay outside the
  // /billing prefix. Nest 11 uses path-to-regexp v8: wildcards must be named.
  app.setGlobalPrefix('billing', {
    exclude: [{ path: 'gateway/*path', method: RequestMethod.ALL }],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .addBearerAuth()
    .setTitle('Oficina Billing Service')
    .setDescription('API de faturamento da oficina mecânica.')
    .setVersion('1.0')
    .addTag('health', 'Health check')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('billing/docs', app, document);

  app.enableCors();
  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
