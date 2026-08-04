import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class InviteTokenDto {
  @ApiProperty({
    description: 'Raw organization invitation token from the email link',
    example: '550e8400-e29b-41d4-a716-446655440000',
    format: 'uuid',
  })
  @IsUUID('4', { message: 'Invitation token must be a valid UUID' })
  token!: string;
}
