import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  IsUUID,
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

export class AcceptInviteWithTemporaryPasswordDto {
  @ApiProperty({
    description: 'Raw organization invitation token from the email link',
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'Invitation token must be a valid UUID' })
  token!: string;

  @ApiProperty({
    description: 'Invited email address',
    example: 'member@example.com',
    maxLength: 254,
  })
  @Transform(({ value }: TransformFnParams): unknown => normalizeEmail(value))
  @Matches(APP_EMAIL_PATTERN, { message: INVALID_EMAIL_MESSAGE })
  @IsNotEmpty({ message: 'Email is required' })
  @MaxLength(254, { message: 'Email must not exceed 254 characters' })
  email!: string;

  @ApiProperty({
    description: 'One-time password from the invitation email',
    example: 'F7K2M9Q4R8ZA',
    minLength: 8,
    maxLength: 32,
  })
  @IsString({ message: 'Temporary password must be a string' })
  @IsNotEmpty({ message: 'Temporary password is required' })
  @MinLength(8, {
    message: 'Temporary password must be at least 8 characters long',
  })
  @MaxLength(32, {
    message: 'Temporary password must not exceed 32 characters',
  })
  temporaryPassword!: string;

  @ApiProperty({
    description:
      'Permanent password containing uppercase, lowercase, number, and special character',
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
