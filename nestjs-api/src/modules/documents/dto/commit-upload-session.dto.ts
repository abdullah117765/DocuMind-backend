import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class CommitUploadSessionDto {
  @ApiPropertyOptional({
    description:
      'Knowledge Base IDs to attach uploaded documents to. If omitted, the organization default Knowledge Base is used.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(5)
  @IsUUID('4', { each: true })
  knowledgeBaseIds?: string[];

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
