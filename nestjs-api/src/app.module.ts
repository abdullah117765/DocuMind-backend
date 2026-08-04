import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import accessControlConfig from './config/access-control.config';
import authConfig from './config/auth.config';
import cookieConfig from './config/cookie.config';
import emailVerificationConfig from './config/email-verification.config';
import mailConfig from './config/mail.config';
import passwordResetConfig from './config/password-reset.config';
import { AccessControlModule } from './modules/access-control/access-control.module';
import { AuthModule } from './modules/auth/auth.module';
import { MailModule } from './modules/mail/mail.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { AuditLogInterceptor } from './modules/platform-admin/audit-log.interceptor';
import { PlatformAdminModule } from './modules/platform-admin/platform-admin.module';
import { PrismaModule } from './modules/prisma/prisma.module';
import { RedisModule } from './modules/redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: '.env',
      isGlobal: true,
      load: [
        accessControlConfig,
        authConfig,
        cookieConfig,
        emailVerificationConfig,
        mailConfig,
        passwordResetConfig,
      ],
    }),
    PrismaModule,
    RedisModule,
    MailModule,
    AuthModule,
    AccessControlModule,
    OrganizationsModule,
    PlatformAdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
  ],
})
export class AppModule {}
