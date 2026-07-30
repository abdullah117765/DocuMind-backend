import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class SessionIdDto {
  @ApiProperty({
    description: 'Device session identifier',
    example: '21e7748f-bd05-46bd-b6a2-c6eb20e1204f',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'Session ID must be a valid UUID' })
  sessionId!: string;
}
