import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  APP_EMAIL_PATTERN,
  INVALID_EMAIL_MESSAGE,
  normalizeEmail,
} from '../../../common/validation/email.validation';

const PASSWORD_COMPLEXITY_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@#$%^&*!]).+$/;

export class RegisterDto {
  @ApiProperty({
    description: 'Email address used to create and verify the account',
    example: 'user@example.com',
    maxLength: 254,
  })
  @Transform(({ value }: TransformFnParams): unknown => normalizeEmail(value))
  @Matches(APP_EMAIL_PATTERN, { message: INVALID_EMAIL_MESSAGE })
  @IsNotEmpty({ message: 'Email is required' })
  @MaxLength(254, { message: 'Email must not exceed 254 characters' })
  email!: string;

  @ApiProperty({
    description:
      'Password containing uppercase, lowercase, number, and special character',
    example: 'SecureP@ss1',
    minLength: 8,
    maxLength: 64,
    format: 'password',
  })
  @IsString({ message: 'Password must be a string' })
  @IsNotEmpty({ message: 'Password is required' })
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @MaxLength(64, { message: 'Password must not exceed 64 characters' })
  @Matches(PASSWORD_COMPLEXITY_PATTERN, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character (@#$%^&*!)',
  })
  password!: string;
}
