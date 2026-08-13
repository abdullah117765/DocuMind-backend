import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class OrganizationKnowledgeBaseIdDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'Organization ID must be a valid UUID' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'Knowledge Base ID must be a valid UUID' })
  knowledgeBaseId!: string;
}

export class OrganizationKnowledgeBaseCollectionIdDto extends OrganizationKnowledgeBaseIdDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'Collection ID must be a valid UUID' })
  collectionId!: string;
}
