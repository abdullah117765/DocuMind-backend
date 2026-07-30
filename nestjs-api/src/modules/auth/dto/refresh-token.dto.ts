import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

const REFRESH_TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/i;

function trimToken(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class RefreshTokenDto {
  @ApiProperty({
    description:
      'Opaque refresh token returned by login or the previous refresh operation',
    example:
      '550e8400-e29b-41d4-a716-446655440000.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ',
    maxLength: 100,
  })
  @Transform(({ value }: TransformFnParams): unknown => trimToken(value))
  @IsString({ message: 'Refresh token must be a string' })
  @IsNotEmpty({ message: 'Refresh token is required' })
  @MaxLength(100, { message: 'Refresh token must not exceed 100 characters' })
  @Matches(REFRESH_TOKEN_PATTERN, {
    message: 'Refresh token format is invalid',
  })
  refreshToken!: string;
}
