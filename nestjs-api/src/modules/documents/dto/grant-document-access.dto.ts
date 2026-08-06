import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class GrantDocumentAccessDto {
  @ApiProperty({
    description: 'Active organization member user ID receiving preview access',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'User ID must be a valid UUID' })
  userId!: string;
}
