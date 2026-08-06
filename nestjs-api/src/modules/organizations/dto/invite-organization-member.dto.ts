import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  APP_EMAIL_PATTERN,
  INVALID_EMAIL_MESSAGE,
  normalizeEmail,
} from '../../../common/validation/email.validation';

const PERSON_NAME_PATTERN = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/;

function normalizePersonName(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
}

export class InviteOrganizationMemberDto {
  @ApiProperty({
    description: 'Full name of the person being invited',
    example: 'Ahmed Khan',
    minLength: 2,
    maxLength: 150,
  })
  @Transform(({ value }: TransformFnParams): unknown => normalizePersonName(value))
  @IsString({ message: 'Name must be a string' })
  @IsNotEmpty({ message: 'Name is required' })
  @MinLength(2, { message: 'Name must be at least 2 characters long' })
  @MaxLength(150, { message: 'Name must not exceed 150 characters' })
  @Matches(PERSON_NAME_PATTERN, {
    message: 'Name can contain only letters, numbers, and single spaces',
  })
  name!: string;

  @ApiProperty({
    description: 'Email address to invite into the organization',
    example: 'member@example.com',
    maxLength: 254,
  })
  @Transform(({ value }: TransformFnParams): unknown => normalizeEmail(value))
  @Matches(APP_EMAIL_PATTERN, { message: INVALID_EMAIL_MESSAGE })
  @IsNotEmpty({ message: 'Email is required' })
  @MaxLength(254, { message: 'Email must not exceed 254 characters' })
  email!: string;

  @ApiPropertyOptional({
    description: 'Organization role ID assigned when the invite is accepted',
    type: [String],
    minItems: 1,
    maxItems: 1,
  })
  @IsOptional()
  @IsArray({ message: 'Role IDs must be an array' })
  @ArrayMinSize(1, { message: 'Select one role for this invitation' })
  @ArrayMaxSize(1, { message: 'Only one role can be assigned to a user' })
  @IsUUID('4', { each: true, message: 'Each role ID must be a valid UUID' })
  roleIds?: string[];
}
