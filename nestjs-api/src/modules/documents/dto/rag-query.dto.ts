import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export enum RagDocumentScope {
  ALL = 'all',
  SELECTED = 'selected',
}

export enum RagSearchType {
  SEMANTIC = 'semantic',
  KEYWORD = 'keyword',
  HYBRID = 'hybrid',
}

export class RagQueryDto {
  @ApiPropertyOptional({
    example: 'What does the leave policy say?',
    minLength: 1,
    maxLength: 4000,
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  query!: string;

  @ApiPropertyOptional({
    enum: RagDocumentScope,
    default: RagDocumentScope.ALL,
  })
  @IsOptional()
  @IsEnum(RagDocumentScope)
  scope?: RagDocumentScope = RagDocumentScope.ALL;

  @ApiPropertyOptional({
    description: 'Required when scope is selected.',
    example: ['550e8400-e29b-41d4-a716-446655440000'],
  })
  @ValidateIf((dto: RagQueryDto) => dto.scope === RagDocumentScope.SELECTED)
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  documentIds?: string[];

  @ApiPropertyOptional({
    enum: RagSearchType,
    default: RagSearchType.HYBRID,
  })
  @IsOptional()
  @IsEnum(RagSearchType)
  searchType?: RagSearchType = RagSearchType.HYBRID;

  @ApiPropertyOptional({
    default: 5,
    maximum: 20,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  topK?: number = 5;
}

export class RagReindexDto {
  @ApiPropertyOptional({
    description: 'If omitted, all hierarchy-accessible documents are reindexed.',
    example: ['550e8400-e29b-41d4-a716-446655440000'],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  documentIds?: string[];
}
