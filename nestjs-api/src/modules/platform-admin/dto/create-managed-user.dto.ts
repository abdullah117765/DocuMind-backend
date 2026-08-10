import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsNotEmpty,
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
const PERSON_NAME_PATTERN = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/;

function normalizePersonName(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
}

export class CreateManagedUserDto {
  @ApiProperty({
    example: 'Ahmed Khan',
    minLength: 2,
    maxLength: 150,
  })
  @Transform(({ value }: TransformFnParams): unknown =>
    normalizePersonName(value),
  )
  @IsString({ message: 'Name must be a string' })
  @IsNotEmpty({ message: 'Name is required' })
  @MinLength(2, { message: 'Name must be at least 2 characters long' })
  @MaxLength(150, { message: 'Name must not exceed 150 characters' })
  @Matches(PERSON_NAME_PATTERN, {
    message: 'Name can contain only letters, numbers, and single spaces',
  })
  name!: string;

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
}
