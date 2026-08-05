import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class AcceptJoinRequestDto {
  @ApiPropertyOptional({
    description:
      'Organization role ID to assign. If omitted, Employee is assigned.',
    type: [String],
    minItems: 1,
    maxItems: 1,
  })
  @IsOptional()
  @IsArray({ message: 'Role IDs must be an array' })
  @ArrayMinSize(1, { message: 'Select one role for this request' })
  @ArrayMaxSize(1, { message: 'Only one role can be assigned to a user' })
  @IsUUID('4', { each: true, message: 'Each role ID must be a valid UUID' })
  roleIds?: string[];
}
