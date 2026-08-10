import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { OrganizationStatus } from '../../../generated/prisma/client';

function optionalInteger({ value }: TransformFnParams): unknown {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return Number(value);
}

export class ListOrganizationsQueryDto {
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

  @ApiPropertyOptional({ example: 'Acme' })
  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Search must be a string' })
  @MaxLength(100, { message: 'Search must not exceed 100 characters' })
  search?: string;

  @ApiPropertyOptional({ enum: OrganizationStatus })
  @IsOptional()
  @IsEnum(OrganizationStatus, {
    message: 'Status must be a valid organization status',
  })
  status?: OrganizationStatus;

  @ApiPropertyOptional({
    enum: ['name', 'newest', 'oldest'],
    default: 'name',
  })
  @IsOptional()
  @IsIn(['name', 'newest', 'oldest'], {
    message: 'Sort must be name, newest, or oldest',
  })
  sort?: 'name' | 'newest' | 'oldest';
}
