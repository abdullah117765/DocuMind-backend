import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthActionResult, AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

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
}
