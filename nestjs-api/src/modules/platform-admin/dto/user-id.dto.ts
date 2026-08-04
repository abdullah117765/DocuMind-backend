import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class UserIdDto {
  @ApiProperty({
    description: 'User identifier',
    example: '7ee81b20-3a9a-4303-b370-89abf77f1bfc',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'User ID must be a valid UUID' })
  userId!: string;
}
