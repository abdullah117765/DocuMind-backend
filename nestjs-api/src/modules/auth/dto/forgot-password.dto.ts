import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsEmail, IsNotEmpty, MaxLength } from 'class-validator';

function normalizeEmail(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export class ForgotPasswordDto {
  @ApiProperty({
    description: 'Email address associated with the account',
    example: 'user@example.com',
    maxLength: 254,
  })
  @Transform(({ value }: TransformFnParams): unknown => normalizeEmail(value))
  @IsEmail({}, { message: 'Email must be a valid email address' })
  @IsNotEmpty({ message: 'Email is required' })
  @MaxLength(254, { message: 'Email must not exceed 254 characters' })
  email!: string;
}
