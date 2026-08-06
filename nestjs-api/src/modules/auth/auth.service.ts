import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcrypt';
import { AuthConfiguration } from '../../config/auth.config';
import { User } from '../../generated/prisma/client';
import { MailService } from '../mail/mail.service';
import { RedisService } from '../redis/redis.service';
import { UsersService } from '../users/users.service';
import {
  AUTH_ERROR_REASONS,
  InvalidPasswordResetAuthorizationException,
  InvalidRefreshTokenException,
} from './auth.exceptions';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyPasswordResetOtpDto } from './dto/verify-password-reset-otp.dto';
import { ResendVerificationEmailDto } from './dto/resend-verification-email.dto';
import {
  EmailVerificationActionResult,
  EmailVerificationResendResult,
  EmailVerificationService,
} from './email-verification.service';
import { EnvSuperAdminService } from './env-super-admin.service';
import { PasswordResetService } from './password-reset.service';
import {
  DeviceMetadata,
  SESSION_REVOCATION_REASONS,
  SessionService,
  SessionWithRefreshToken,
} from './session.service';
import { TokenService } from './token.service';

const PASSWORD_HASH_ROUNDS = 12;
const DUMMY_PASSWORD_HASH =
  '$2b$12$puR9afvrAILWKKnVKbDCX.0CXlT.969TXmlk0BC2aAbR/9yjc5..y';
const PASSWORD_RESET_REQUEST_MESSAGE =
  'A six-digit verification code has been sent to your email.';

export interface AuthActionResult {
  message: string;
}

export interface PasswordResetRequestResult extends AuthActionResult {
  data: {
    cooldownSeconds: number;
    expiresInSeconds: number;
  };
}

export interface PasswordResetOtpVerificationResult extends AuthActionResult {
  data: {
    resetToken: string;
    expiresInSeconds: number;
  };
}

export interface PasswordResetSessionResult {
  data: {
    expiresInSeconds: number;
  };
}

export interface AuthenticatedSessionResult {
  data: {
    user: {
      id: string;
      name?: string;
      email: string;
      isVerified: boolean;
      isSuperAdmin?: boolean;
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
    private readonly emailVerificationService: EmailVerificationService,
    private readonly envSuperAdminService: EnvSuperAdminService,
    configService: ConfigService,
  ) {
    this.authConfig = configService.getOrThrow<AuthConfiguration>('auth');
  }

  async register(_dto: RegisterDto): Promise<AuthActionResult> {
    throw new GoneException(
      'Public sign-up is disabled. Ask an administrator for an invitation.',
    );
  }

  verifyEmail(token: string): Promise<EmailVerificationActionResult> {
    return this.emailVerificationService.verify(token);
  }

  resendVerificationEmail(
    dto: ResendVerificationEmailDto,
    ipAddress?: string | null,
  ): Promise<EmailVerificationResendResult> {
    return this.emailVerificationService.resend(dto.email, ipAddress);
  }

  async login(
    dto: LoginDto,
    metadata: DeviceMetadata = {},
  ): Promise<AuthenticatedSessionResult> {
    const rateLimitIdentifiers = this.getLoginRateLimitIdentifiers(
      dto.email,
      metadata.ipAddress,
    );
    const failureStates = await Promise.all(
      rateLimitIdentifiers.map((identifier) =>
        this.redisService.getLoginFailureState(identifier),
      ),
    );
    const blockedState = failureStates.find(
      (state) => state.attempts >= this.authConfig.loginRateLimit.maxAttempts,
    );

    if (blockedState) {
      throw new HttpException(
        {
          message: 'Too many login attempts. Please try again later.',
          details: { retryAfterSeconds: blockedState.retryAfterSeconds },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (this.envSuperAdminService.isConfiguredEmail(dto.email)) {
      const superAdminUser = await this.envSuperAdminService.authenticate(
        dto.email,
        dto.password,
      );

      if (!superAdminUser) {
        await Promise.all(
          rateLimitIdentifiers.map((identifier) =>
            this.redisService.recordLoginFailure(
              identifier,
              this.authConfig.loginRateLimit.windowSeconds,
            ),
          ),
        );
        throw new UnauthorizedException('Invalid email or password');
      }

      await Promise.all(
        rateLimitIdentifiers.map((identifier) =>
          this.redisService.clearLoginFailures(identifier),
        ),
      );

      const session = await this.sessionService.createSession(
        superAdminUser.id,
        metadata,
      );

      return this.createAuthenticatedSessionResult(superAdminUser, session);
    }

    const user = await this.usersService.findByEmail(dto.email);
    const passwordMatches = await compare(
      dto.password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordMatches) {
      await Promise.all(
        rateLimitIdentifiers.map((identifier) =>
          this.redisService.recordLoginFailure(
            identifier,
            this.authConfig.loginRateLimit.windowSeconds,
          ),
        ),
      );
      throw new UnauthorizedException('Invalid email or password');
    }

    await Promise.all(
      rateLimitIdentifiers.map((identifier) =>
        this.redisService.clearLoginFailures(identifier),
      ),
    );

    if (!user.isVerified) {
      throw new ForbiddenException({
        message: 'Please verify your email before logging in.',
        details: { reason: AUTH_ERROR_REASONS.emailNotVerified },
      });
    }

    if (user.isActive === false) {
      throw new ForbiddenException('This account has been deactivated.');
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

    const refreshedUser =
      user && this.envSuperAdminService.isConfiguredUser(user)
        ? await this.envSuperAdminService.ensureUserRecord()
        : user;

    if (
      !refreshedUser ||
      !refreshedUser.isVerified ||
      refreshedUser.isActive === false
    ) {
      await this.sessionService.revokeSession(
        rotatedSession.session.id,
        SESSION_REVOCATION_REASONS.accountUnavailable,
      );
      throw new InvalidRefreshTokenException();
    }

    return this.createAuthenticatedSessionResult(refreshedUser, rotatedSession);
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
    ipAddress?: string | null,
  ): Promise<PasswordResetRequestResult> {
    if (this.envSuperAdminService.isConfiguredEmail(dto.email)) {
      throw new BadRequestException(
        'Super Admin password is managed through environment variables. Update SUPER_ADMIN_PASSWORD and restart the API.',
      );
    }

    await this.passwordResetService.assertRequestAllowed(dto.email, ipAddress);

    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new NotFoundException('No account found with this email address');
    }

    if (!user.isVerified) {
      throw new ForbiddenException({
        message:
          'Verify your email address before resetting this account password.',
        details: { reason: AUTH_ERROR_REASONS.emailNotVerified },
      });
    }

    let otpIssued = false;

    try {
      const otp = await this.passwordResetService.issueOtp(user.id);
      otpIssued = true;
      await this.mailService.sendPasswordResetOtp(
        user.email,
        otp,
        this.passwordResetService.getExpiryMinutes(),
      );
    } catch (error: unknown) {
      if (user && otpIssued) {
        await this.passwordResetService.invalidateOtp(user.id).catch(() => {
          // Preserve the original failure while removing an unusable OTP.
        });
      }
      await this.passwordResetService
        .releaseRequestCooldown(dto.email)
        .catch(() => {
          // Preserve the original failure while allowing a later retry.
        });
      throw error;
    }

    return this.createPasswordResetRequestResult();
  }

  async verifyPasswordResetOtp(
    dto: VerifyPasswordResetOtpDto,
  ): Promise<PasswordResetOtpVerificationResult> {
    const user = await this.usersService.findByEmail(dto.email);

    if (this.envSuperAdminService.isConfiguredEmail(dto.email)) {
      throw new BadRequestException(
        'Super Admin password is managed through environment variables. Update SUPER_ADMIN_PASSWORD and restart the API.',
      );
    }

    if (!user) {
      throw new NotFoundException('No account found with this email address');
    }

    if (!user.isVerified) {
      throw new ForbiddenException({
        message:
          'Verify your email address before resetting this account password.',
        details: { reason: AUTH_ERROR_REASONS.emailNotVerified },
      });
    }

    const resetToken =
      await this.passwordResetService.verifyOtpAndIssueAuthorization(
        user.id,
        dto.otp,
      );

    return {
      message: 'Code verified. You can now choose a new password.',
      data: {
        resetToken,
        expiresInSeconds:
          this.passwordResetService.getAuthorizationTtlSeconds(),
      },
    };
  }

  async getPasswordResetSession(
    resetToken: string,
  ): Promise<PasswordResetSessionResult> {
    const authorization =
      await this.passwordResetService.getAuthorizationStatus(resetToken);

    return {
      data: {
        expiresInSeconds: Math.max(
          Math.ceil((authorization.expiresAt.getTime() - Date.now()) / 1000),
          1,
        ),
      },
    };
  }

  async resetPassword(
    dto: ResetPasswordDto,
    resetToken: string,
  ): Promise<AuthActionResult> {
    const authorization =
      await this.passwordResetService.getAuthorizationStatus(resetToken);
    const user = await this.usersService.findById(authorization.userId);

    if (!user) {
      throw new InvalidPasswordResetAuthorizationException();
    }

    if (this.envSuperAdminService.isConfiguredUser(user)) {
      throw new BadRequestException(
        'Super Admin password is managed through environment variables. Update SUPER_ADMIN_PASSWORD and restart the API.',
      );
    }

    if (await compare(dto.newPassword, user.passwordHash)) {
      throw new BadRequestException({
        message: 'Choose a password you have not already been using.',
        details: { reason: AUTH_ERROR_REASONS.passwordUnchanged },
      });
    }

    const passwordHash = await hash(dto.newPassword, PASSWORD_HASH_ROUNDS);

    await this.passwordResetService.completePasswordReset(
      resetToken,
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

    const superAdminMetadata =
      this.envSuperAdminService.getSessionUserMetadata(user);

    return {
      data: {
        user: {
          id: user.id,
          ...(user.name ? { name: user.name } : {}),
          email: user.email,
          isVerified: user.isVerified,
          ...(superAdminMetadata ?? {}),
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

  private getLoginRateLimitIdentifiers(
    email: string,
    ipAddress: string | null | undefined,
  ): [string, string] {
    return [
      `account:${email.trim().toLowerCase()}`,
      `ip:${ipAddress?.trim() || 'unknown'}`,
    ];
  }

  private createPasswordResetRequestResult(): PasswordResetRequestResult {
    return {
      message: PASSWORD_RESET_REQUEST_MESSAGE,
      data: {
        cooldownSeconds: this.passwordResetService.getResendCooldownSeconds(),
        expiresInSeconds: this.passwordResetService.getOtpTtlSeconds(),
      },
    };
  }
}
