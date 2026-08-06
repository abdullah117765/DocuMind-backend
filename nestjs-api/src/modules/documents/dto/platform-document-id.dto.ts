import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class PlatformDocumentIdDto {
  @ApiProperty({
    description: 'Document identifier',
    format: 'uuid',
    example: '58e00226-8217-40cc-aa59-f8e688cdcc52',
  })
  @IsUUID('4', { message: 'Document ID must be a valid UUID' })
  documentId!: string;
}
