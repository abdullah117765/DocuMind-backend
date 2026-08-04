import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  APP_EMAIL_PATTERN,
  INVALID_EMAIL_MESSAGE,
  normalizeEmail,
} from '../../../common/validation/email.validation';

const PASSWORD_COMPLEXITY_PATTERN =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@#$%^&*!]).+$/;

export class CreateManagedUserDto {
  @ApiProperty({
    example: 'member@example.com',
    maxLength: 254,
  })
  @Transform(({ value }: TransformFnParams): unknown => normalizeEmail(value))
  @Matches(APP_EMAIL_PATTERN, { message: INVALID_EMAIL_MESSAGE })
  @IsNotEmpty({ message: 'Email is required' })
  @MaxLength(254, { message: 'Email must not exceed 254 characters' })
  email!: string;

  @ApiProperty({
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
      'Password must contain uppercase, lowercase, number, and one special character (@#$%^&*!)',
  })
  password!: string;

  @ApiPropertyOptional({
    description: 'Create as verified so the account can be used immediately',
    default: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'Verified must be true or false' })
  isVerified?: boolean;
}
