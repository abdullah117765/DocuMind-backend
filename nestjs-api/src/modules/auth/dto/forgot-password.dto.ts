import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsNotEmpty, Matches, MaxLength } from 'class-validator';
import {
  APP_EMAIL_PATTERN,
  INVALID_EMAIL_MESSAGE,
  normalizeEmail,
} from '../../../common/validation/email.validation';

export class ForgotPasswordDto {
  @ApiProperty({
    description: 'Email address associated with the account',
    example: 'user@example.com',
    maxLength: 254,
  })
  @Transform(({ value }: TransformFnParams): unknown => normalizeEmail(value))
  @Matches(APP_EMAIL_PATTERN, { message: INVALID_EMAIL_MESSAGE })
  @IsNotEmpty({ message: 'Email is required' })
  @MaxLength(254, { message: 'Email must not exceed 254 characters' })
  email!: string;
}
