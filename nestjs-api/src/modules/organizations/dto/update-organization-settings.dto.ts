import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

function normalizeText(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
}

function normalizeSlug(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

export class UpdateOrganizationSettingsDto {
  @ApiPropertyOptional({
    description: 'Display name for the tenant organization',
    example: 'Acme Finance',
    minLength: 2,
    maxLength: 150,
  })
  @Transform(({ value }: TransformFnParams): unknown => normalizeText(value))
  @IsOptional()
  @MinLength(2, { message: 'Organization name must be at least 2 characters' })
  @MaxLength(150, {
    message: 'Organization name must not exceed 150 characters',
  })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9 .&'_-]*$/, {
    message:
      'Organization name may contain letters, numbers, spaces, dots, ampersands, apostrophes, underscores, and hyphens',
  })
  name?: string;

  @ApiPropertyOptional({
    description: 'URL-safe tenant slug',
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
    description: 'Whether users can discover this tenant and request access',
    example: true,
  })
  @IsOptional()
  @IsBoolean({ message: 'Join request setting must be true or false' })
  allowJoinRequests?: boolean;
}
