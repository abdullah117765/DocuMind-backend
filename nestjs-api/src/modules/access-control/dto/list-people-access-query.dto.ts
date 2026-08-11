import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

function optionalInteger({ value }: TransformFnParams): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return Number(value);
}

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export const PEOPLE_ACCESS_SOURCES = [
  'all',
  'member',
  'invite',
  'request',
] as const;

export const PEOPLE_ACCESS_STATUSES = [
  'all',
  'ACTIVE',
  'SUSPENDED',
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'REVOKED',
  'EXPIRED',
  'CANCELED',
] as const;

export class ListPeopleAccessQueryDto {
  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @IsOptional()
  @Transform(optionalInteger)
  @IsInt({ message: 'Page must be an integer' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number;

  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Transform(optionalInteger)
  @IsInt({ message: 'Page size must be an integer' })
  @Min(1, { message: 'Page size must be at least 1' })
  @Max(100, { message: 'Page size must not exceed 100' })
  pageSize?: number;

  @ApiPropertyOptional({ example: 'ali@example.com' })
  @IsOptional()
  @Transform(trimString)
  @IsString({ message: 'Search must be a string' })
  @MaxLength(100, { message: 'Search must not exceed 100 characters' })
  search?: string;

  @ApiPropertyOptional({ enum: PEOPLE_ACCESS_SOURCES })
  @IsOptional()
  @IsIn(PEOPLE_ACCESS_SOURCES, {
    message: 'Type must be all, member, invite, or request',
  })
  source?: (typeof PEOPLE_ACCESS_SOURCES)[number];

  @ApiPropertyOptional({ enum: PEOPLE_ACCESS_STATUSES })
  @IsOptional()
  @IsIn(PEOPLE_ACCESS_STATUSES, {
    message: 'Status must be a valid people access status',
  })
  status?: (typeof PEOPLE_ACCESS_STATUSES)[number];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'Role ID must be a valid UUID' })
  roleId?: string;
}
