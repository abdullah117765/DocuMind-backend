import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getCookieValue } from '../../../common/utils/cookie.util';
import { AuthConfiguration } from '../../../config/auth.config';
import { CookieConfiguration } from '../../../config/cookie.config';
import { UsersService } from '../../users/users.service';
import { EnvSuperAdminService } from '../env-super-admin.service';
import { AuthenticatedPrincipal } from '../interfaces/authenticated-principal.interface';
import { SessionService } from '../session.service';
import { AccessTokenPayload } from '../token.service';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseAccessTokenPayload(value: unknown): AccessTokenPayload | null {
  if (!isRecord(value)) {
    return null;
  }

  const { sub, sid, jti } = value;

  if (
    typeof sub !== 'string' ||
    typeof sid !== 'string' ||
    typeof jti !== 'string' ||
    !UUID_V4_PATTERN.test(sub) ||
    !UUID_V4_PATTERN.test(sid) ||
    !UUID_V4_PATTERN.test(jti)
  ) {
    return null;
  }

  return {
    sub,
    sid,
    jti,
  };
}

function accessCookieExtractor(
  cookieName: string,
): (request: Request) => string | null {
  return (request: Request): string | null =>
    getCookieValue(request.headers.cookie, cookieName);
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly sessionService: SessionService,
    private readonly usersService: UsersService,
    private readonly envSuperAdminService: EnvSuperAdminService,
  ) {
    const authConfig = configService.getOrThrow<AuthConfiguration>('auth');
    const cookieConfig =
      configService.getOrThrow<CookieConfiguration>('cookies');

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        accessCookieExtractor(cookieConfig.accessCookieName),
      ]),
      ignoreExpiration: false,
      secretOrKey: authConfig.accessToken.secret,
      issuer: authConfig.accessToken.issuer,
      audience: authConfig.accessToken.audience,
    });
  }

  async validate(payload: unknown): Promise<AuthenticatedPrincipal> {
    const parsedPayload = parseAccessTokenPayload(payload);

    if (!parsedPayload) {
      throw new UnauthorizedException();
    }

    const session = await this.sessionService.findActiveSession(
      parsedPayload.sid,
    );

    if (!session || session.userId !== parsedPayload.sub) {
      throw new UnauthorizedException();
    }

    const user = await this.usersService.findById(parsedPayload.sub);

    if (!user) {
      throw new UnauthorizedException();
    }

    const superAdminMetadata =
      this.envSuperAdminService.getSessionUserMetadata(user);

    if (!superAdminMetadata && (!user.isVerified || user.isActive === false)) {
      throw new UnauthorizedException();
    }

    const nameMetadata = superAdminMetadata
      ? {
          isEnvSuperAdmin: true,
          name: superAdminMetadata.name,
        }
      : user.name
        ? { name: user.name }
        : {};

    return {
      userId: user.id,
      email: user.email,
      isVerified: superAdminMetadata ? true : user.isVerified,
      ...nameMetadata,
      sessionId: session.id,
      tokenId: parsedPayload.jti,
    };
  }
}
