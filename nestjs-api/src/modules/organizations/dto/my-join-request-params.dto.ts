import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class MyJoinRequestParamsDto {
  @ApiProperty({
    description: 'Join request identifier',
    example: '58e00226-8217-40cc-aa59-f8e688cdcc52',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'Join request ID must be a valid UUID' })
  requestId!: string;
}
