import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const PASSWORD_COMPLEXITY_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@#$%^&*!]).+$/;

function normalizeEmail(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function trimOtp(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class ResetPasswordDto {
  @ApiProperty({
    description: 'Email address that requested the reset code',
    example: 'user@example.com',
    maxLength: 254,
  })
  @Transform(({ value }: TransformFnParams): unknown => normalizeEmail(value))
  @IsEmail({}, { message: 'Email must be a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @MaxLength(254, { message: 'Email must not exceed 254 characters' })
  email!: string;

  @ApiProperty({
    description: 'Six-digit password reset code sent by email',
    example: '042817',
    minLength: 6,
    maxLength: 6,
  })
  @Transform(({ value }: TransformFnParams): unknown => trimOtp(value))
  @IsString({ message: 'OTP must be a string' })
  @Matches(/^\d{6}$/, {
    message: 'OTP must contain exactly 6 digits',
  })
  otp!: string;

  @ApiProperty({
    description:
      'New password containing uppercase, lowercase, number, and special character',
    example: 'NewSecureP@ss2',
    minLength: 8,
    maxLength: 64,
    format: 'password',
  })
  @IsString({ message: 'New password must be a string' })
  @IsNotEmpty({ message: 'New password is required' })
  @MinLength(8, {
    message: 'New password must be at least 8 characters long',
  })
  @MaxLength(64, {
    message: 'New password must not exceed 64 characters',
  })
  @Matches(PASSWORD_COMPLEXITY_PATTERN, {
    message:
      'New password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@#$%^&*!)',
  })
  newPassword!: string;
}
