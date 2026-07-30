import { Transform, type TransformFnParams } from 'class-transformer';
import { IsNotEmpty, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

function trimToken(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class VerifyEmailDto {
  @ApiProperty({
    description: 'Single-use email verification token',
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  @Transform(({ value }: TransformFnParams): unknown => trimToken(value))
  @IsUUID('4', { message: 'Token must be a valid UUID' })
  @IsNotEmpty({ message: 'Token is required' })
  token!: string;
}
