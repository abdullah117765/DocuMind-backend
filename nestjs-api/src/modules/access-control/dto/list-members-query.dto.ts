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

export class ListMembersQueryDto {
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
  @Transform(({ value }): unknown =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: 'Search must be a string' })
  @MaxLength(100, { message: 'Search must not exceed 100 characters' })
  search?: string;

  @ApiPropertyOptional({ enum: ['active', 'suspended', 'all'] })
  @IsOptional()
  @IsIn(['active', 'suspended', 'all'], {
    message: 'Status must be active, suspended, or all',
  })
  status?: 'active' | 'suspended' | 'all';

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'Role ID must be a valid UUID' })
  roleId?: string;
}
