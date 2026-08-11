import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { createAppValidationPipe } from './common/pipes/app-validation.pipe';
import { configureSwagger } from './config/swagger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.enableShutdownHooks();

  const configuredApiPrefix = configService.get<string>('API_PREFIX', 'api');
  const apiPrefix = configuredApiPrefix.replace(/^\/+|\/+$/g, '') || 'api';
  const frontendOrigins = configService
    .get<string>('FRONTEND_URL', 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const port = Number(configService.get<string>('PORT', '3000'));

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

  app.setGlobalPrefix(apiPrefix);
  app.use((request: Request, response: Response, next: NextFunction) => {
    const incomingRequestId = request.headers['x-request-id'];
    const requestId =
      typeof incomingRequestId === 'string' && incomingRequestId.length <= 80
        ? incomingRequestId
        : randomUUID();

    response.setHeader('x-request-id', requestId);
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.enableCors({
    credentials: true,
    exposedHeaders: [
      'Content-Disposition',
      'X-Audit-Log-Export-Count',
      'X-Audit-Log-Export-Truncated',
      'X-Request-Id',
    ],
    origin: frontendOrigins,
  });
  app.useGlobalPipes(createAppValidationPipe());

  configureSwagger(app, configService, apiPrefix);

  await app.listen(port);
}
void bootstrap();
