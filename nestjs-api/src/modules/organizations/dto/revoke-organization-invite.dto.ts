import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

function normalizeOptionalReason({ value }: TransformFnParams): unknown {
  if (typeof value !== 'string') return value;

  const normalized = value.trim().replace(/\s+/g, ' ');

  return normalized || undefined;
}

export class RevokeOrganizationInviteDto {
  @ApiPropertyOptional({
    description: 'Reason shown in invite history when an invitation is revoked',
    maxLength: 500,
  })
  @Transform(normalizeOptionalReason)
  @IsOptional()
  @IsString({ message: 'Revocation reason must be a string' })
  @MaxLength(500, {
    message: 'Revocation reason must not exceed 500 characters',
  })
  revocationReason?: string;
}
