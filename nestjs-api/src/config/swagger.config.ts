import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureSwagger(
  app: INestApplication,
  configService: ConfigService,
  apiPrefix: string,
): void {
  const config = new DocumentBuilder()
    .setTitle(
      configService.get<string>(
        'SWAGGER_TITLE',
        'AI Document Intelligence API',
      ),
    )
    .setDescription('Backend API for the AI Document Intelligence Platform.')
    .setVersion(configService.get<string>('SWAGGER_VERSION', '1.0'))
    .addBearerAuth(
      {
        bearerFormat: 'JWT',
        scheme: 'bearer',
        type: 'http',
      },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);
}
