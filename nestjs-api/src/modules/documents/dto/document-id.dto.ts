import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class DocumentIdDto {
  @ApiProperty({
    description: 'Organization identifier',
    format: 'uuid',
    example: '3c84ea89-6b30-4d90-a444-c12ba29777fb',
  })
  @IsUUID('4', { message: 'Organization ID must be a valid UUID' })
  organizationId!: string;

  @ApiProperty({
    description: 'Document identifier',
    format: 'uuid',
    example: '58e00226-8217-40cc-aa59-f8e688cdcc52',
  })
  @IsUUID('4', { message: 'Document ID must be a valid UUID' })
  documentId!: string;
}
