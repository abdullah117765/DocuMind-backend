import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsString,
  Matches,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const PERMISSION_CODE_PATTERN = /^[a-z][a-z0-9._:-]{0,119}$/;

function normalizePermissionCodes(value: unknown): unknown {
  if (!Array.isArray(value)) {
    return value;
  }

  const values: unknown[] = value;

  return values.map((code) => (typeof code === 'string' ? code.trim() : code));
}

export class UpdateRolePermissionsDto {
  @ApiProperty({
    description:
      'Complete replacement set of active organization permission codes; an empty array removes every permission',
    example: ['documents.read', 'documents.update', 'analytics.view'],
    type: [String],
    maxItems: 100,
  })
  @Transform(({ value }: TransformFnParams): unknown =>
    normalizePermissionCodes(value),
  )
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
  permissionCodes!: string[];
}
