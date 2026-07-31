import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class OrganizationRoleParamsDto {
  @ApiProperty({
    description: 'Organization identifier',
    example: '3c84ea89-6b30-4d90-a444-c12ba29777fb',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'Organization ID must be a valid UUID' })
  organizationId!: string;

  @ApiProperty({
    description: 'Role identifier',
    example: 'b429b596-1865-4ace-bd6d-9ca3b52da710',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'Role ID must be a valid UUID' })
  roleId!: string;
}
