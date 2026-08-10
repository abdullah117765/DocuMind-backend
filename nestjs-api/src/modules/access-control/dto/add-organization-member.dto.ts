import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  APP_EMAIL_PATTERN,
  INVALID_EMAIL_MESSAGE,
  normalizeEmail,
} from '../../../common/validation/email.validation';

export class AddOrganizationMemberDto {
  @ApiProperty({
    description: 'Email of an existing verified user',
    example: 'employee@example.com',
    maxLength: 254,
  })
  @Transform(({ value }: TransformFnParams): unknown => normalizeEmail(value))
  @Matches(APP_EMAIL_PATTERN, { message: INVALID_EMAIL_MESSAGE })
  @MaxLength(254, { message: 'Email must not exceed 254 characters' })
  email!: string;

  @ApiPropertyOptional({
    description: 'Initial organization role ID. Exactly one role is required.',
    type: [String],
    example: ['b429b596-1865-4ace-bd6d-9ca3b52da710'],
    minItems: 1,
    maxItems: 1,
    default: [],
  })
  @IsOptional()
  @IsArray({ message: 'Role IDs must be an array' })
  @ArrayMinSize(1, {
    message: 'Select one role for this member',
  })
  @ArrayMaxSize(1, {
    message: 'Only one role can be assigned to a user',
  })
  @ArrayUnique({ message: 'Role IDs must be unique' })
  @IsUUID('4', {
    each: true,
    message: 'Each role ID must be a valid UUID',
  })
  roleIds?: string[];
}
