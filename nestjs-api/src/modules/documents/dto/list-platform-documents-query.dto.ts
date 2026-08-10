import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DocumentStatus } from '../../../generated/prisma/client';

export class ListPlatformDocumentsQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by organization',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Organization ID must be a valid UUID' })
  organizationId?: string;

  @ApiPropertyOptional({
    enum: DocumentStatus,
    description: 'Filter by document status. Defaults to non-purged documents.',
  })
  @IsOptional()
  @IsEnum(DocumentStatus, { message: 'Status must be a valid document status' })
  status?: DocumentStatus;

  @ApiPropertyOptional({
    description: 'Search by file name, uploader, or organization',
    maxLength: 100,
  })
  @IsOptional()
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Search must be a string' })
  @MaxLength(100, { message: 'Search must not exceed 100 characters' })
  search?: string;

  @ApiPropertyOptional({
    description: 'Filter documents updated within a recent window',
    enum: ['24h', '7d', '30d'],
  })
  @IsOptional()
  @IsIn(['24h', '7d', '30d'], {
    message: 'Updated range must be 24h, 7d, or 30d',
  })
  updatedRange?: '24h' | '7d' | '30d';

  @ApiPropertyOptional({
    description: 'Sort documents by last updated time',
    enum: ['newest', 'oldest'],
    default: 'newest',
  })
  @IsOptional()
  @IsIn(['newest', 'oldest'], {
    message: 'Sort must be newest or oldest',
  })
  sort?: 'newest' | 'oldest';

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page must be an integer' })
  @Min(1, { message: 'Page must be at least 1' })
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Page size must be an integer' })
  @Min(1, { message: 'Page size must be at least 1' })
  @Max(100, { message: 'Page size must not exceed 100' })
  pageSize?: number;
}
