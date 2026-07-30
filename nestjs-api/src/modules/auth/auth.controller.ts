import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  AuthActionResult,
  AuthenticatedSessionResult,
  AuthService,
} from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
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

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in and create a device session' })
  @ApiHeader({
    name: 'x-device-name',
    required: false,
    description: 'Friendly device label, such as Chrome on Windows',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    description: 'Login successful and access/refresh tokens issued',
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
          accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          refreshToken:
            '550e8400-e29b-41d4-a716-446655440000.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ',
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
  login(
    @Body() dto: LoginDto,
    @Req() request: Request,
  ): Promise<AuthenticatedSessionResult> {
    return this.authService.login(dto, this.getDeviceMetadata(request));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate a refresh token and issue a new token pair',
  })
  @ApiBody({ type: RefreshTokenDto })
  @ApiOkResponse({
    description:
      'Refresh token rotated and replacement access/refresh tokens issued',
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
          accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          refreshToken:
            '6ba7b810-9dad-41d1-80b4-00c04fd430c8.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ',
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Refresh token input validation failed',
  })
  @ApiResponse({
    status: 498,
    description:
      'Refresh token is invalid, expired, revoked, or has already been used',
  })
  refresh(@Body() dto: RefreshTokenDto): Promise<AuthenticatedSessionResult> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email a one-time password reset code' })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiOkResponse({
    description: 'Generic response returned whether or not the account exists',
    schema: {
      example: {
        status: 'success',
        code: 200,
        message:
          'If an account exists for that email, a password reset code has been sent.',
      },
    },
  })
  @ApiBadRequestResponse({
    description: 'Email validation failed',
  })
  @ApiTooManyRequestsResponse({
    description: 'Too many password reset requests',
  })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() request: Request,
  ): Promise<AuthActionResult> {
    return this.authService.forgotPassword(dto, request.ip);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset a password using the emailed one-time code',
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
    description: 'Email, OTP, or new-password validation failed',
  })
  @ApiResponse({
    status: 498,
    description:
      'The password reset code is invalid, expired, used, or locked after too many attempts',
  })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<AuthActionResult> {
    return this.authService.resetPassword(dto);
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access-token')
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

  @Get('verify-email')
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
    description: 'Verification token format validation failed',
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
    status: 498,
    description: 'Verification token is invalid or expired',
    schema: {
      example: {
        status: 'error',
        code: 498,
        message: 'Invalid or expired verification token',
      },
    },
  })
  verifyEmail(@Query() dto: VerifyEmailDto): Promise<AuthActionResult> {
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
