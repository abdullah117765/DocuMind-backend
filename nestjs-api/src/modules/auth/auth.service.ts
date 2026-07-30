import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
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
import {
  InvalidPasswordResetOtpException,
  InvalidRefreshTokenException,
} from './auth.exceptions';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { PasswordResetService } from './password-reset.service';
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
const DUMMY_PASSWORD_RESET_USER_ID = '00000000-0000-4000-8000-000000000000';
const PASSWORD_RESET_REQUEST_MESSAGE =
  'If an account exists for that email, a password reset code has been sent.';

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

export interface ActiveSessionsResult {
  data: {
    sessions: Array<{
      id: string;
      deviceName: string | null;
      userAgent: string | null;
      ipAddress: string | null;
      createdAt: Date;
      lastActiveAt: Date;
      expiresAt: Date;
      isCurrent: boolean;
    }>;
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
    private readonly passwordResetService: PasswordResetService,
    configService: ConfigService,
  ) {
    this.authConfig = configService.getOrThrow<AuthConfiguration>('auth');
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

    if (failureState.attempts >= this.authConfig.loginRateLimit.maxAttempts) {
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

    const session = await this.sessionService.createSession(user.id, metadata);

    return this.createAuthenticatedSessionResult(user, session);
  }

  async refresh(rawRefreshToken: string): Promise<AuthenticatedSessionResult> {
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

  async forgotPassword(
    dto: ForgotPasswordDto,
    ipAddress?: string | null,
  ): Promise<AuthActionResult> {
    await this.passwordResetService.assertRequestAllowed(dto.email, ipAddress);

    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      return {
        message: PASSWORD_RESET_REQUEST_MESSAGE,
      };
    }

    const otp = await this.passwordResetService.issueOtp(user.id);

    try {
      await this.mailService.sendPasswordResetOtp(
        user.email,
        otp,
        this.passwordResetService.getExpiryMinutes(),
      );
    } catch (error: unknown) {
      await this.passwordResetService.invalidateOtp(user.id).catch(() => {
        // Preserve the mail failure while making a best effort to remove its OTP.
      });
      throw error;
    }

    return {
      message: PASSWORD_RESET_REQUEST_MESSAGE,
    };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<AuthActionResult> {
    const user = await this.usersService.findByEmail(dto.email);

    await this.passwordResetService.verifyAndConsumeOtp(
      user?.id ?? DUMMY_PASSWORD_RESET_USER_ID,
      dto.otp,
    );

    if (!user) {
      throw new InvalidPasswordResetOtpException();
    }

    const passwordHash = await hash(dto.newPassword, PASSWORD_HASH_ROUNDS);

    await this.sessionService.resetPasswordAndRevokeSessions(
      user.id,
      passwordHash,
    );

    return {
      message: 'Password reset successfully. Please log in again.',
    };
  }

  async getActiveSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<ActiveSessionsResult> {
    const sessions = await this.sessionService.listActiveUserSessions(userId);

    return {
      data: {
        sessions: sessions
          .map((session) => ({
            id: session.id,
            deviceName: session.deviceName,
            userAgent: session.userAgent,
            ipAddress: session.ipAddress,
            createdAt: session.createdAt,
            lastActiveAt: session.lastActiveAt,
            expiresAt: session.expiresAt,
            isCurrent: session.id === currentSessionId,
          }))
          .sort(
            (left, right) => Number(right.isCurrent) - Number(left.isCurrent),
          ),
      },
    };
  }

  async logoutCurrentSession(
    userId: string,
    sessionId: string,
  ): Promise<AuthActionResult> {
    await this.sessionService.revokeUserSession(
      userId,
      sessionId,
      SESSION_REVOCATION_REASONS.logout,
    );

    return {
      message: 'Logged out successfully',
    };
  }

  async logoutSession(
    userId: string,
    sessionId: string,
  ): Promise<AuthActionResult> {
    const revoked = await this.sessionService.revokeUserSession(
      userId,
      sessionId,
      SESSION_REVOCATION_REASONS.logout,
    );

    if (!revoked) {
      throw new NotFoundException('Active session not found');
    }

    return {
      message: 'Session logged out successfully',
    };
  }

  async logoutAllSessions(userId: string): Promise<AuthActionResult> {
    await this.sessionService.revokeAllUserSessions(
      userId,
      SESSION_REVOCATION_REASONS.logoutAll,
    );

    return {
      message: 'Logged out from all devices successfully',
    };
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
