import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  APP_EMAIL_PATTERN,
  INVALID_EMAIL_MESSAGE,
  normalizeEmail,
} from '../../../common/validation/email.validation';
import { UpdateOrganizationLimitsDto } from './update-organization-limits.dto';
import { UpdateOrganizationSubscriptionDto } from './update-organization-subscription.dto';

function normalizeText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
}

function normalizeSlug(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

const ORGANIZATION_NAME_PATTERN = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/;

export class CreateOrganizationDto {
  @ApiProperty({
    description: 'Display name for the tenant organization',
    example: 'Acme Finance',
    minLength: 2,
    maxLength: 150,
  })
  @Transform(({ value }: TransformFnParams): unknown => normalizeText(value))
  @IsNotEmpty({ message: 'Organization name is required' })
  @MinLength(2, { message: 'Organization name must be at least 2 characters' })
  @MaxLength(150, {
    message: 'Organization name must not exceed 150 characters',
  })
  @Matches(ORGANIZATION_NAME_PATTERN, {
    message:
      'Organization name can contain only letters, numbers, and single spaces',
  })
  name!: string;

  @ApiPropertyOptional({
    description:
      'URL-safe tenant slug. If omitted, the backend generates one from the name.',
    example: 'acme-finance',
    minLength: 2,
    maxLength: 100,
  })
  @Transform(({ value }: TransformFnParams): unknown => normalizeSlug(value))
  @IsOptional()
  @MinLength(2, { message: 'Organization slug must be at least 2 characters' })
  @MaxLength(100, {
    message: 'Organization slug must not exceed 100 characters',
  })
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message:
      'Organization slug may contain lowercase letters, numbers, and single hyphens',
  })
  slug?: string;

  @ApiPropertyOptional({
    description:
      'Optional active verified user email to assign as the first Organization Admin. Super Admin remains outside tenant membership.',
    example: 'admin@acme-finance.com',
    maxLength: 254,
  })
  @Transform(({ value }: TransformFnParams): unknown => normalizeEmail(value))
  @IsOptional()
  @MaxLength(254, { message: 'First admin email must not exceed 254 characters' })
  @Matches(APP_EMAIL_PATTERN, { message: INVALID_EMAIL_MESSAGE })
  firstAdminEmail?: string;

  @ApiPropertyOptional({
    description:
      'Whether users can discover this tenant and request access. Defaults to true.',
    example: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'Join request setting must be true or false' })
  allowJoinRequests?: boolean;

  @ApiPropertyOptional({
    description:
      'Deprecated compatibility field. Subscription/payment setup is disabled and this value is ignored.',
    type: UpdateOrganizationSubscriptionDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateOrganizationSubscriptionDto)
  subscription?: UpdateOrganizationSubscriptionDto;

  @ApiPropertyOptional({
    description:
      'Deprecated compatibility field. Organization limits are disabled and this value is ignored.',
    type: UpdateOrganizationLimitsDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateOrganizationLimitsDto)
  limits?: UpdateOrganizationLimitsDto;
}
