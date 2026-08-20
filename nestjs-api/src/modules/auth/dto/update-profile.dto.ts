import { ApiProperty } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const DISPLAY_NAME_PATTERN = /^[\p{L}\p{N}]+(?: [\p{L}\p{N}]+)*$/u;

function normalizeDisplayName(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim().replace(/\s+/g, ' ');
}

export class UpdateProfileDto {
  @ApiProperty({
    description: 'Display name shown in the account profile',
    example: 'Ahmed Khan',
    minLength: 2,
    maxLength: 60,
  })
  @Transform(({ value }: TransformFnParams): unknown =>
    normalizeDisplayName(value),
  )
  @IsString({ message: 'Name must be text' })
  @IsNotEmpty({ message: 'Name is required' })
  @MinLength(2, { message: 'Name must be at least 2 characters long' })
  @MaxLength(60, { message: 'Name must not exceed 60 characters' })
  @Matches(DISPLAY_NAME_PATTERN, {
    message: 'Name can contain letters, numbers, and single spaces only',
  })
  name!: string;
}
