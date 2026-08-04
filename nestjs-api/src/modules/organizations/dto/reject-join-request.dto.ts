import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

function normalizeOptionalText({ value }: TransformFnParams): unknown {
  if (typeof value !== 'string') return value;

  const normalized = value.trim().replace(/\s+/g, ' ');

  return normalized || undefined;
}

export class RejectJoinRequestDto {
  @ApiPropertyOptional({
    description: 'Optional rejection reason shown to the requester',
    maxLength: 1000,
  })
  @Transform(normalizeOptionalText)
  @IsOptional()
  @IsString({ message: 'Rejection reason must be a string' })
  @MaxLength(1000, {
    message: 'Rejection reason must not exceed 1000 characters',
  })
  rejectionReason?: string;
}
