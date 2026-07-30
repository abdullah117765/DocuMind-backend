import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtModuleOptions, JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthConfiguration } from '../../config/auth.config';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './token.service';

@Module({
  imports: [
    UsersModule,
    PassportModule.register({
      defaultStrategy: 'jwt',
    }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService): JwtModuleOptions => {
        const authConfig = configService.getOrThrow<AuthConfiguration>('auth');

        return {
          secret: authConfig.accessToken.secret,
          signOptions: {
            expiresIn: authConfig.accessToken
              .expiresIn as JwtSignOptions['expiresIn'],
            issuer: authConfig.accessToken.issuer,
            audience: authConfig.accessToken.audience,
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtAuthGuard,
    JwtStrategy,
    SessionService,
    TokenService,
  ],
  exports: [AuthService, JwtAuthGuard, SessionService, TokenService],
})
export class AuthModule {}
