import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Param,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  AuthCookieService,
  BrowserAuthenticatedSessionResult,
} from './auth-cookie.service';
import {
  InvalidPasswordResetAuthorizationException,
  InvalidRefreshTokenException,
} from './auth.exceptions';
import {
  ActiveSessionsResult,
  AuthActionResult,
  AuthService,
  PasswordResetRequestResult,
  PasswordResetSessionResult,
} from './auth.service';
import { CsrfService } from './csrf.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationEmailDto } from './dto/resend-verification-email.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SessionIdDto } from './dto/session-id.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { VerifyPasswordResetOtpDto } from './dto/verify-password-reset-otp.dto';
import type { AuthenticatedPrincipal } from './interfaces/authenticated-principal.interface';
import type { DeviceMetadata } from './session.service';

interface CurrentAuthenticationResult {
  data: {
    user: {
      id: string;
      email: string;
      isVerified: boolean;
    };
    session: {
      id: string;
    };
  };
}

interface CsrfTokenResult {
  data: {
    csrfToken: string;
  };
}

interface BrowserPasswordResetVerificationResult extends AuthActionResult {
  data: {
    expiresInSeconds: number;
  };
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authCookieService: AuthCookieService,
    private readonly csrfService: CsrfService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({
    description:
      'User created and a verification link sent to their email address',
    schema: {
      example: {
        status: 'success',
        code: 201,
        message:
          'Registration successful. Please check your email to verify your account.',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Email or password validation failed',
    schema: {
      example: {
        status: 'error',
        code: 400,
        message: 'Validation failed',
        details: [
          {
            field: 'password',
            issue: 'Password must be at least 8 characters long',
          },
        ],
      },
    },
  })
  @ApiConflictResponse({
    description: 'The email address is already registered',
    schema: {
      example: {
        status: 'error',
        code: 409,
        message: 'Email is already registered',
      },
    },
  })
  register(@Body() dto: RegisterDto): Promise<AuthActionResult> {
    return this.authService.register(dto);
  }

  @Get('csrf')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue a signed CSRF token and matching cookie' })
  @ApiOkResponse({
    description:
      'CSRF token returned in the response and a readable CSRF cookie',
    schema: {
      example: {
        status: 'success',
        code: 200,
        data: {
          csrfToken: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ',
        },
      },
    },
  })
  getCsrfToken(
    @Res({ passthrough: true }) response: Response,
  ): CsrfTokenResult {
    return {
      data: {
        csrfToken: this.csrfService.issueToken(response),
      },
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Log in and create a device session' })
  @ApiHeader({
    name: 'x-csrf-token',
    required: true,
    description: 'Token returned by GET /auth/csrf',
  })
  @ApiHeader({
    name: 'x-device-name',
    required: false,
    description: 'Friendly device label, such as Chrome on Windows',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    description:
      'Login successful; access and refresh tokens set as HttpOnly cookies',
    schema: {
      example: {
        status: 'success',
        code: 200,
        data: {
          user: {
            id: '7ee81b20-3a9a-4303-b370-89abf77f1bfc',
            email: 'user@example.com',
            isVerified: true,
          },
          session: {
            id: '21e7748f-bd05-46bd-b6a2-c6eb20e1204f',
            expiresAt: '2026-08-29T12:00:00.000Z',
          },
        },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Login input validation failed' })
  @ApiUnauthorizedResponse({ description: 'Email or password is incorrect' })
  @ApiForbiddenResponse({
    description: 'The account email has not been verified',
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many failed login attempts',
  })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BrowserAuthenticatedSessionResult> {
    const result = await this.authService.login(
      dto,
      this.getDeviceMetadata(request),
    );

    this.authCookieService.setAuthenticationCookies(response, result);

    return this.authCookieService.toBrowserResult(result);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiCookieAuth('refresh-cookie')
  @ApiOperation({
    summary: 'Rotate a refresh token and issue a new token pair',
  })
  @ApiHeader({
    name: 'x-csrf-token',
    required: true,
    description: 'Token returned by GET /auth/csrf',
  })
  @ApiOkResponse({
    description: 'Refresh token rotated and replacement HttpOnly cookies set',
    schema: {
      example: {
        status: 'success',
        code: 200,
        data: {
          user: {
            id: '7ee81b20-3a9a-4303-b370-89abf77f1bfc',
            email: 'user@example.com',
            isVerified: true,
          },
          session: {
            id: '21e7748f-bd05-46bd-b6a2-c6eb20e1204f',
            expiresAt: '2026-08-29T12:15:00.000Z',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 498,
    description:
      'Refresh token is invalid, expired, revoked, or has already been used',
  })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BrowserAuthenticatedSessionResult> {
    const refreshToken = this.authCookieService.getRefreshToken(request);

    if (!refreshToken) {
      this.authCookieService.clearAuthenticationCookies(response);
      throw new InvalidRefreshTokenException();
    }

    try {
      const result = await this.authService.refresh(refreshToken);

      this.authCookieService.setAuthenticationCookies(response, result);

      return this.authCookieService.toBrowserResult(result);
    } catch (error: unknown) {
      this.authCookieService.clearAuthenticationCookies(response);
      throw error;
    }
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email a one-time password reset code' })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiOkResponse({
    description: 'A reset code was sent to the registered account',
    schema: {
      example: {
        status: 'success',
        code: 200,
        message: 'A six-digit verification code has been sent to your email.',
        data: {
          cooldownSeconds: 40,
          expiresInSeconds: 120,
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Email validation failed',
  })
  @ApiNotFoundResponse({
    description: 'No account exists for the supplied email address',
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many password reset requests',
  })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PasswordResetRequestResult> {
    this.authCookieService.clearPasswordResetCookie(response);
    return this.authService.forgotPassword(dto, request.ip);
  }

  @Post('verify-password-reset-otp')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiOperation({ summary: 'Verify a password-reset OTP' })
  @ApiHeader({
    name: 'x-csrf-token',
    required: true,
    description: 'Token returned by GET /auth/csrf',
  })
  @ApiBody({ type: VerifyPasswordResetOtpDto })
  @ApiOkResponse({
    description:
      'OTP verified and a short-lived HttpOnly password-reset session created',
    schema: {
      example: {
        status: 'success',
        code: 200,
        message: 'Code verified. You can now choose a new password.',
        data: {
          expiresInSeconds: 120,
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Email or OTP validation failed',
  })
  @ApiNotFoundResponse({
    description: 'No account exists for the supplied email address',
  })
  @ApiResponse({
    status: 498,
    description: 'OTP is invalid, expired, used, or locked',
  })
  async verifyPasswordResetOtp(
    @Body() dto: VerifyPasswordResetOtpDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<BrowserPasswordResetVerificationResult> {
    const result = await this.authService.verifyPasswordResetOtp(dto);

    this.authCookieService.setPasswordResetCookie(
      response,
      result.data.resetToken,
      result.data.expiresInSeconds,
    );

    return {
      message: result.message,
      data: { expiresInSeconds: result.data.expiresInSeconds },
    };
  }

  @Get('password-reset-session')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Inspect the active browser password-reset session',
  })
  @ApiOkResponse({
    description: 'Password-reset session is active',
    schema: {
      example: {
        status: 'success',
        code: 200,
        data: { expiresInSeconds: 120 },
      },
    },
  })
  getPasswordResetSession(
    @Req() request: Request,
  ): Promise<PasswordResetSessionResult> {
    const resetToken = this.authCookieService.getPasswordResetToken(request);

    if (!resetToken) {
      throw new InvalidPasswordResetAuthorizationException();
    }

    return this.authService.getPasswordResetSession(resetToken);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiOperation({
    summary: 'Set a new password after OTP verification',
  })
  @ApiHeader({
    name: 'x-csrf-token',
    required: true,
    description: 'Token returned by GET /auth/csrf',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOkResponse({
    description: 'Password reset and all existing sessions revoked',
    schema: {
      example: {
        status: 'success',
        code: 200,
        message: 'Password reset successfully. Please log in again.',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Password-reset session or new-password validation failed',
  })
  @ApiResponse({
    status: 498,
    description:
      'The password reset session is invalid, expired, or already used',
  })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthActionResult> {
    const resetToken = this.authCookieService.getPasswordResetToken(request);

    if (!resetToken) {
      throw new InvalidPasswordResetAuthorizationException();
    }

    try {
      const result = await this.authService.resetPassword(dto, resetToken);

      this.authCookieService.clearPasswordResetCookie(response);
      this.authCookieService.clearAuthenticationCookies(response);

      return result;
    } catch (error: unknown) {
      if (
        error instanceof HttpException &&
        [409, 410, 498].includes(error.getStatus())
      ) {
        this.authCookieService.clearPasswordResetCookie(response);
      }
      throw error;
    }
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('access-cookie')
  @ApiOperation({ summary: 'Get the current authenticated user and session' })
  @ApiOkResponse({
    description: 'Current authenticated user and session',
    schema: {
      example: {
        status: 'success',
        code: 200,
        data: {
          user: {
            id: '7ee81b20-3a9a-4303-b370-89abf77f1bfc',
            email: 'user@example.com',
            isVerified: true,
          },
          session: {
            id: '21e7748f-bd05-46bd-b6a2-c6eb20e1204f',
          },
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Access token is missing, invalid, or expired',
  })
  me(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): CurrentAuthenticationResult {
    return {
      data: {
        user: {
          id: principal.userId,
          email: principal.email,
          isVerified: principal.isVerified,
        },
        session: {
          id: principal.sessionId,
        },
      },
    };
  }

  @Get('sessions')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('access-cookie')
  @ApiOperation({ summary: 'List active device sessions' })
  @ApiOkResponse({
    description: 'Active sessions with the current device identified',
    schema: {
      example: {
        status: 'success',
        code: 200,
        data: {
          sessions: [
            {
              id: '21e7748f-bd05-46bd-b6a2-c6eb20e1204f',
              deviceName: 'Chrome on Windows',
              userAgent: 'Mozilla/5.0',
              ipAddress: '127.0.0.1',
              createdAt: '2026-07-30T12:00:00.000Z',
              lastActiveAt: '2026-07-30T12:00:00.000Z',
              expiresAt: '2026-08-29T12:00:00.000Z',
              isCurrent: true,
            },
          ],
        },
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Access token is missing, invalid, or its session is inactive',
  })
  getActiveSessions(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<ActiveSessionsResult> {
    return this.authService.getActiveSessions(
      principal.userId,
      principal.sessionId,
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('access-cookie')
  @ApiHeader({
    name: 'x-csrf-token',
    required: true,
    description: 'Token returned by GET /auth/csrf',
  })
  @ApiOperation({ summary: 'Log out the current device session' })
  @ApiOkResponse({
    description: 'Current session and its refresh tokens revoked',
    schema: {
      example: {
        status: 'success',
        code: 200,
        message: 'Logged out successfully',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Access token is missing, invalid, or its session is inactive',
  })
  async logout(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthActionResult> {
    const result = await this.authService.logoutCurrentSession(
      principal.userId,
      principal.sessionId,
    );

    this.authCookieService.clearAuthenticationCookies(response);

    return result;
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('access-cookie')
  @ApiHeader({
    name: 'x-csrf-token',
    required: true,
    description: 'Token returned by GET /auth/csrf',
  })
  @ApiOperation({ summary: 'Log out one owned device session' })
  @ApiOkResponse({
    description: 'Selected session and its refresh tokens revoked',
    schema: {
      example: {
        status: 'success',
        code: 200,
        message: 'Session logged out successfully',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Session ID is not a UUID v4',
  })
  @ApiUnauthorizedResponse({
    description: 'Access token is missing, invalid, or its session is inactive',
  })
  @ApiNotFoundResponse({
    description:
      'The session is inactive, does not exist, or belongs to another user',
  })
  async logoutSession(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param() dto: SessionIdDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthActionResult> {
    const result = await this.authService.logoutSession(
      principal.userId,
      dto.sessionId,
    );

    if (dto.sessionId === principal.sessionId) {
      this.authCookieService.clearAuthenticationCookies(response);
    }

    return result;
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('access-cookie')
  @ApiHeader({
    name: 'x-csrf-token',
    required: true,
    description: 'Token returned by GET /auth/csrf',
  })
  @ApiOperation({ summary: 'Log out every device session' })
  @ApiOkResponse({
    description: 'Every session and refresh token for the user revoked',
    schema: {
      example: {
        status: 'success',
        code: 200,
        message: 'Logged out from all devices successfully',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Access token is missing, invalid, or its session is inactive',
  })
  async logoutAll(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthActionResult> {
    const result = await this.authService.logoutAllSessions(principal.userId);

    this.authCookieService.clearAuthenticationCookies(response);

    return result;
  }

  @Post('resend-verification-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend an account email-verification link' })
  @ApiBody({ type: ResendVerificationEmailDto })
  @ApiOkResponse({
    description: 'A generic resend result that does not disclose account state',
    schema: {
      example: {
        status: 'success',
        code: 200,
        message:
          'If an unverified account exists for this email, a new verification link has been sent.',
        data: { cooldownSeconds: 60 },
      },
    },
  })
  @ApiTooManyRequestsResponse({
    description: 'The resend cooldown or request limit has been reached',
  })
  resendVerificationEmail(
    @Body() dto: ResendVerificationEmailDto,
    @Req() request: Request,
  ) {
    return this.authService.resendVerificationEmail(dto, request.ip);
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify a registered email address' })
  @ApiOkResponse({
    description: 'Email address verified successfully',
    schema: {
      example: {
        status: 'success',
        code: 200,
        message: 'Email verified successfully',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Verification token is malformed or unknown',
    schema: {
      example: {
        status: 'error',
        code: 400,
        message: 'Validation failed',
        details: [
          {
            field: 'token',
            issue: 'Token must be a valid UUID',
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.GONE,
    description: 'Verification token has expired',
    schema: {
      example: {
        status: 'error',
        code: 410,
        message:
          'This verification link has expired. Request a fresh link to continue.',
      },
    },
  })
  @ApiConflictResponse({
    description: 'Verification token was already used or replaced',
  })
  verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  private getDeviceMetadata(request: Request): DeviceMetadata {
    return {
      deviceName: request.get('x-device-name'),
      userAgent: request.get('user-agent'),
      ipAddress: request.ip,
    };
  }
}
