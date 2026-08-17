import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const HUMAN_NAME_PATTERN = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/;
const TAG_NAME_PATTERN = /^[A-Za-z0-9]+(?:[- ][A-Za-z0-9]+)*$/;

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
}

export class ListKnowledgeBasesQueryDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Search must be a string' })
  @MaxLength(100, { message: 'Search must not exceed 100 characters' })
  search?: string;

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

export class CreateKnowledgeBaseDto {
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Name must be text' })
  @MinLength(2, { message: 'Name must contain at least 2 characters' })
  @MaxLength(120, { message: 'Name must not exceed 120 characters' })
  @Matches(HUMAN_NAME_PATTERN, {
    message: 'Name can contain letters, numbers, and single spaces only',
  })
  name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Description must be text' })
  @MaxLength(500, { message: 'Description must not exceed 500 characters' })
  description?: string;
}

export class UpdateKnowledgeBaseDto {
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Name must be text' })
  @MinLength(2, { message: 'Name must contain at least 2 characters' })
  @MaxLength(120, { message: 'Name must not exceed 120 characters' })
  @Matches(HUMAN_NAME_PATTERN, {
    message: 'Name can contain letters, numbers, and single spaces only',
  })
  name?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Description must be text' })
  @MaxLength(500, { message: 'Description must not exceed 500 characters' })
  description?: string;
}

export class CreateKnowledgeBaseCollectionDto {
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Name must be text' })
  @MinLength(2, { message: 'Name must contain at least 2 characters' })
  @MaxLength(120, { message: 'Name must not exceed 120 characters' })
  @Matches(HUMAN_NAME_PATTERN, {
    message: 'Name can contain letters, numbers, and single spaces only',
  })
  name!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Description must be text' })
  @MaxLength(500, { message: 'Description must not exceed 500 characters' })
  description?: string;
}

export class CreateKnowledgeBaseFolderDto {
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Name must be text' })
  @MinLength(2, { message: 'Name must contain at least 2 characters' })
  @MaxLength(120, { message: 'Name must not exceed 120 characters' })
  @Matches(HUMAN_NAME_PATTERN, {
    message: 'Name can contain letters, numbers, and single spaces only',
  })
  name!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'Parent folder ID must be a valid UUID' })
  parentId?: string;
}

export class CreateKnowledgeBaseCategoryDto {
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Name must be text' })
  @MinLength(2, { message: 'Name must contain at least 2 characters' })
  @MaxLength(80, { message: 'Name must not exceed 80 characters' })
  @Matches(HUMAN_NAME_PATTERN, {
    message: 'Name can contain letters, numbers, and single spaces only',
  })
  name!: string;
}

export class CreateKnowledgeBaseTagDto {
  @Transform(({ value }) => trimString(value))
  @IsString({ message: 'Name must be text' })
  @MinLength(2, { message: 'Tag must contain at least 2 characters' })
  @MaxLength(60, { message: 'Tag must not exceed 60 characters' })
  @Matches(TAG_NAME_PATTERN, {
    message: 'Tag can contain letters, numbers, spaces, and hyphens only',
  })
  name!: string;
}

export class DocumentKnowledgeBaseAssignmentDto {
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(5)
  @IsUUID('4', { each: true })
  knowledgeBaseIds!: string[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'Folder ID must be a valid UUID' })
  folderId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  collectionIds?: string[];

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'Category ID must be a valid UUID' })
  categoryId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  tagIds?: string[];
}

export class MoveKnowledgeBaseDocumentDto {
  @IsUUID('4', { message: 'Target Knowledge Base ID must be a valid UUID' })
  targetKnowledgeBaseId!: string;
}

export class UpdateCollectionDocumentsDto {
  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  documentIds!: string[];
}
