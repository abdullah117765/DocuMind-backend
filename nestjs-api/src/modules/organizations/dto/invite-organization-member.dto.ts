import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  APP_EMAIL_PATTERN,
  INVALID_EMAIL_MESSAGE,
  normalizeEmail,
} from '../../../common/validation/email.validation';

export class InviteOrganizationMemberDto {
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
    description: 'Organization role IDs assigned when the invite is accepted',
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'Role IDs must be an array' })
  @ArrayMaxSize(25, { message: 'No more than 25 roles can be assigned' })
  @IsUUID('4', { each: true, message: 'Each role ID must be a valid UUID' })
  roleIds?: string[];
}
