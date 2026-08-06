import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class DocumentStagedFileIdDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'Organization ID must be a valid UUID' })
  organizationId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'Upload session ID must be a valid UUID' })
  sessionId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'Staged file ID must be a valid UUID' })
  fileId!: string;
}
