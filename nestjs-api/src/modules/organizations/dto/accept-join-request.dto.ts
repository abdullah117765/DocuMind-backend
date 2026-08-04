import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';

export class AcceptJoinRequestDto {
  @ApiPropertyOptional({
    description:
      'Organization role IDs to assign. If omitted, Employee is assigned.',
    type: [String],
  })
  @IsOptional()
  @IsArray({ message: 'Role IDs must be an array' })
  @ArrayMaxSize(25, { message: 'No more than 25 roles can be assigned' })
  @IsUUID('4', { each: true, message: 'Each role ID must be a valid UUID' })
  roleIds?: string[];
}
