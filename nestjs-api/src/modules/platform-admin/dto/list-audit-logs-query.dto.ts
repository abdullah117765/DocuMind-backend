import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

function optionalInteger({ value }: TransformFnParams): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return Number(value);
}

export class ListAuditLogsQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Transform(optionalInteger)
  @IsInt({ message: 'Page must be an integer' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(optionalInteger)
  @IsInt({ message: 'Page size must be an integer' })
  @Min(1, { message: 'Page size must be at least 1' })
  @Max(100, { message: 'Page size must not exceed 100' })
  pageSize?: number;

  @ApiPropertyOptional({ example: 'POST /api/users' })
  @IsOptional()
  @IsString({ message: 'Search must be a string' })
  search?: string;

  @ApiPropertyOptional({ example: 'POST /api/users' })
  @IsOptional()
  @IsString({ message: 'Action must be a string' })
  action?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'Actor user ID must be a valid UUID' })
  actorUserId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'Organization ID must be a valid UUID' })
  organizationId?: string;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString({}, { message: 'From date must be an ISO date string' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-05T00:00:00.000Z' })
  @IsOptional()
  @IsDateString({}, { message: 'To date must be an ISO date string' })
  to?: string;
}
