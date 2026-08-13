import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListDocumentsQueryDto {
  @ApiPropertyOptional({
    description: 'Document list view',
    enum: ['active', 'trash'],
    default: 'active',
  })
  @IsOptional()
  @IsIn(['active', 'trash'], { message: 'View must be active or trash' })
  view?: 'active' | 'trash';

  @ApiPropertyOptional({
    description:
      'Search by document name, original filename, uploader name, or uploader email',
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

  @ApiPropertyOptional({
    description: 'Filter by AI preparation status for Ask Documents',
    enum: ['ready', 'preparing', 'needs_attention', 'no_readable_text'],
  })
  @IsOptional()
  @IsIn(['ready', 'preparing', 'needs_attention', 'no_readable_text'], {
    message:
      'AI status must be ready, preparing, needs_attention, or no_readable_text',
  })
  ragStatus?: 'ready' | 'preparing' | 'needs_attention' | 'no_readable_text';

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
