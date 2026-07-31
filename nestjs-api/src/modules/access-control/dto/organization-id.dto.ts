import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class OrganizationIdDto {
  @ApiProperty({
    description: 'Organization identifier',
    example: '3c84ea89-6b30-4d90-a444-c12ba29777fb',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'Organization ID must be a valid UUID' })
  organizationId!: string;
}
