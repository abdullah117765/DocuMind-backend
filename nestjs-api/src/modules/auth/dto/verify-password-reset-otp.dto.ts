import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import {
  APP_EMAIL_PATTERN,
  INVALID_EMAIL_MESSAGE,
  normalizeEmail,
} from '../../../common/validation/email.validation';

function trimOtp(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class VerifyPasswordResetOtpDto {
  @ApiProperty({
    description: 'Email address that requested the reset code',
    example: 'user@example.com',
    maxLength: 254,
  })
  @Transform(({ value }: TransformFnParams): unknown => normalizeEmail(value))
  @Matches(APP_EMAIL_PATTERN, { message: INVALID_EMAIL_MESSAGE })
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
}
