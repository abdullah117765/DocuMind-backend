import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureSwagger(
  app: INestApplication,
  configService: ConfigService,
  apiPrefix: string,
): void {
  const accessCookieName = configService.get<string>(
    'ACCESS_COOKIE_NAME',
    'access_token',
  );
  const refreshCookieName = configService.get<string>(
    'REFRESH_COOKIE_NAME',
    'refresh_token',
  );
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
    .addCookieAuth(accessCookieName, undefined, 'access-cookie')
    .addCookieAuth(refreshCookieName, undefined, 'refresh-cookie')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);
}
