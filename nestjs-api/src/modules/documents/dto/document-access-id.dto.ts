import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class DocumentAccessIdDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'Organization ID must be a valid UUID' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'Document ID must be a valid UUID' })
  documentId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'Access grant ID must be a valid UUID' })
  accessId!: string;
}
