import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const ROLE_NAME_PATTERN = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/;

function normalizeName(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
}

function normalizeDescription(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  return value.trim() || null;
}

export class UpdateRoleDto {
  @ApiPropertyOptional({
    description: 'Replacement role name',
    example: 'Senior Document Reviewer',
    minLength: 2,
    maxLength: 100,
  })
  @Transform(({ value }: TransformFnParams): unknown => normalizeName(value))
  @IsOptional()
  @IsString({ message: 'Role name must be a string' })
  @IsNotEmpty({ message: 'Role name cannot be empty' })
  @MinLength(2, { message: 'Role name must be at least 2 characters long' })
  @MaxLength(100, { message: 'Role name must not exceed 100 characters' })
  @Matches(ROLE_NAME_PATTERN, {
    message:
      'Role name can contain only letters, numbers, and single spaces',
  })
  name?: string;

  @ApiPropertyOptional({
    description: 'Replacement role description; null removes it',
    example: 'Reviews documents and approves exports.',
    nullable: true,
    maxLength: 500,
  })
  @Transform(({ value }: TransformFnParams): unknown =>
    normalizeDescription(value),
  )
  @IsOptional()
  @IsString({ message: 'Role description must be a string' })
  @MaxLength(500, {
    message: 'Role description must not exceed 500 characters',
  })
  description?: string | null;
}
