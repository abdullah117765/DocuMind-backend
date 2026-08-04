import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class JoinRequestParamsDto {
  @ApiProperty({
    description: 'Organization identifier',
    example: '3c84ea89-6b30-4d90-a444-c12ba29777fb',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'Organization ID must be a valid UUID' })
  organizationId!: string;

  @ApiProperty({
    description: 'Join request identifier',
    example: '58e00226-8217-40cc-aa59-f8e688cdcc52',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'Join request ID must be a valid UUID' })
  requestId!: string;
}
