import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
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
  app.enableCors({
    credentials: true,
    origin: frontendOrigins,
  });
  app.useGlobalPipes(createAppValidationPipe());

  configureSwagger(app, configService, apiPrefix);

  await app.listen(port);
}
void bootstrap();
