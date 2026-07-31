import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsOptional,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

function normalizeEmail(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export class AddOrganizationMemberDto {
  @ApiProperty({
    description: 'Email of an existing verified user',
    example: 'employee@example.com',
    maxLength: 254,
  })
  @Transform(({ value }: TransformFnParams): unknown => normalizeEmail(value))
  @IsEmail({}, { message: 'Email must be a valid email address' })
  @MaxLength(254, { message: 'Email must not exceed 254 characters' })
  email!: string;

  @ApiPropertyOptional({
    description:
      'Initial organization role IDs; an empty or omitted array creates a member without a role',
    type: [String],
    example: ['b429b596-1865-4ace-bd6d-9ca3b52da710'],
    maxItems: 20,
    default: [],
  })
  @IsOptional()
  @IsArray({ message: 'Role IDs must be an array' })
  @ArrayMaxSize(20, {
    message: 'A member cannot have more than 20 roles',
  })
  @ArrayUnique({ message: 'Role IDs must be unique' })
  @IsUUID('4', {
    each: true,
    message: 'Each role ID must be a valid UUID',
  })
  roleIds?: string[];
}
