import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

function normalizeOptionalText({ value }: TransformFnParams): unknown {
  if (typeof value !== 'string') return value;

  const normalized = value.trim().replace(/\s+/g, ' ');

  return normalized || undefined;
}

export class CreateJoinRequestDto {
  @ApiPropertyOptional({
    description: 'Optional note explaining why the user wants access',
    maxLength: 1000,
  })
  @Transform(normalizeOptionalText)
  @IsOptional()
  @IsString({ message: 'Message must be a string' })
  @MaxLength(1000, { message: 'Message must not exceed 1000 characters' })
  message?: string;
}
