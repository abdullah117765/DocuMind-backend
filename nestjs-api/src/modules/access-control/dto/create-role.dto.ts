import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const PERMISSION_CODE_PATTERN = /^[a-z][a-z0-9._:-]{0,119}$/;
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

function normalizePermissionCodes(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  const values: unknown[] = value;

  return values.map((code) => (typeof code === 'string' ? code.trim() : code));
}

export class CreateRoleDto {
  @ApiProperty({
    description: 'Unique role name within the organization',
    example: 'Document Reviewer',
    minLength: 2,
    maxLength: 100,
  })
  @Transform(({ value }: TransformFnParams): unknown => normalizeName(value))
  @IsString({ message: 'Role name must be a string' })
  @IsNotEmpty({ message: 'Role name is required' })
  @MinLength(2, { message: 'Role name must be at least 2 characters long' })
  @MaxLength(100, { message: 'Role name must not exceed 100 characters' })
  @Matches(ROLE_NAME_PATTERN, {
    message:
      'Role name can contain only letters, numbers, and single spaces',
  })
  name!: string;

  @ApiPropertyOptional({
    description: 'Human-readable explanation of the role',
    example: 'Reviews extracted document data before export.',
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

  @ApiPropertyOptional({
    description:
      'Active organization permission codes initially granted to the role',
    example: ['documents.read', 'analytics.view'],
    type: [String],
    default: [],
    maxItems: 100,
  })
  @Transform(({ value }: TransformFnParams): unknown =>
    normalizePermissionCodes(value),
  )
  @IsOptional()
  @IsArray({ message: 'Permission codes must be an array' })
  @ArrayMaxSize(100, {
    message: 'A role cannot contain more than 100 permissions',
  })
  @ArrayUnique({ message: 'Permission codes must be unique' })
  @IsString({ each: true, message: 'Each permission code must be a string' })
  @Matches(PERMISSION_CODE_PATTERN, {
    each: true,
    message: 'Each permission code must use a valid permission-code format',
  })
  permissionCodes?: string[];
}
