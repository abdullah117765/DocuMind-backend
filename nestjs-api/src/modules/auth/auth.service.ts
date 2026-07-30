import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { AuthConfiguration } from '../../config/auth.config';
import { User } from '../../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import { InvalidRefreshTokenException } from './auth.exceptions';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import {
  DeviceMetadata,
  SESSION_REVOCATION_REASONS,
  SessionService,
  SessionWithRefreshToken,
} from './session.service';
import { TokenService } from './token.service';

const PASSWORD_HASH_ROUNDS = 12;
const INVALID_TOKEN_STATUS = 498;
const DUMMY_PASSWORD_HASH =
  '$2b$12$puR9afvrAILWKKnVKbDCX.0CXlT.969TXmlk0BC2aAbR/9yjc5..y';

export interface AuthActionResult {
  message: string;
}

export interface AuthenticatedSessionResult {
  data: {
    user: {
      id: string;
      email: string;
      isVerified: boolean;
    };
    session: {
      id: string;
      expiresAt: Date;
    };
    accessToken: string;
    refreshToken: string;
  };
}

@Injectable()
export class AuthService {
  private readonly authConfig: AuthConfiguration;

  constructor(
    private readonly usersService: UsersService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    configService: ConfigService,
  ) {
    this.authConfig =
      configService.getOrThrow<AuthConfiguration>('auth');
  }

  async register(dto: RegisterDto): Promise<AuthActionResult> {
    const existingUser = await this.usersService.findByEmail(dto.email);

    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await hash(dto.password, PASSWORD_HASH_ROUNDS);
    const user = await this.usersService.create({
      email: dto.email,
      passwordHash,
    });
    const verificationToken = randomUUID();

    await this.redisService.storeVerificationToken(verificationToken, user.id);
    await this.mailService.sendVerificationEmail(user.email, verificationToken);

    return {
      message:
        'Registration successful. Please check your email to verify your account.',
    };
  }

  async verifyEmail(token: string): Promise<AuthActionResult> {
    const userId = await this.redisService.getVerificationUserId(token);

    if (!userId) {
      throw new HttpException(
        'Invalid or expired verification token',
        INVALID_TOKEN_STATUS,
      );
    }

    await this.usersService.markVerified(userId);
    await this.redisService.deleteVerificationToken(token);

    return {
      message: 'Email verified successfully',
    };
  }

  async login(
    dto: LoginDto,
    metadata: DeviceMetadata = {},
  ): Promise<AuthenticatedSessionResult> {
    const rateLimitIdentifier = this.getLoginRateLimitIdentifier(
      dto.email,
      metadata.ipAddress,
    );
    const failureState =
      await this.redisService.getLoginFailureState(rateLimitIdentifier);

    if (
      failureState.attempts >=
      this.authConfig.loginRateLimit.maxAttempts
    ) {
      throw new HttpException(
        'Too many login attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.usersService.findByEmail(dto.email);
    const passwordMatches = await compare(
      dto.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordMatches) {
      await this.redisService.recordLoginFailure(
        rateLimitIdentifier,
        this.authConfig.loginRateLimit.windowSeconds,
      );
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.redisService.clearLoginFailures(rateLimitIdentifier);

    if (!user.isVerified) {
      throw new ForbiddenException(
        'Please verify your email before logging in',
      );
    }

    const session = await this.sessionService.createSession(
      user.id,
      metadata,
    );

    return this.createAuthenticatedSessionResult(user, session);
  }

  async refresh(
    rawRefreshToken: string,
  ): Promise<AuthenticatedSessionResult> {
    const rotatedSession =
      await this.sessionService.rotateRefreshToken(rawRefreshToken);
    const user = await this.usersService.findById(
      rotatedSession.session.userId,
    );

    if (!user || !user.isVerified) {
      await this.sessionService.revokeSession(
        rotatedSession.session.id,
        SESSION_REVOCATION_REASONS.accountUnavailable,
      );
      throw new InvalidRefreshTokenException();
    }

    return this.createAuthenticatedSessionResult(user, rotatedSession);
  }

  private async createAuthenticatedSessionResult(
    user: User,
    sessionWithToken: SessionWithRefreshToken,
  ): Promise<AuthenticatedSessionResult> {
    let accessToken: string;

    try {
      accessToken = await this.tokenService.createAccessToken(
        user.id,
        sessionWithToken.session.id,
      );
    } catch (error: unknown) {
      await this.sessionService.revokeSession(
        sessionWithToken.session.id,
        SESSION_REVOCATION_REASONS.tokenIssueFailure,
      );
      throw error;
    }

    return {
      data: {
        user: {
          id: user.id,
          email: user.email,
          isVerified: user.isVerified,
        },
        session: {
          id: sessionWithToken.session.id,
          expiresAt: sessionWithToken.session.expiresAt,
        },
        accessToken,
        refreshToken: sessionWithToken.refreshToken,
      },
    };
  }

  private getLoginRateLimitIdentifier(
    email: string,
    ipAddress: string | null | undefined,
  ): string {
    return `${email.trim().toLowerCase()}|${ipAddress?.trim() || 'unknown'}`;
  }
}
