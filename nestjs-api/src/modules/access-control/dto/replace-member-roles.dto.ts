import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReplaceMemberRolesDto {
  @ApiProperty({
    description:
      'Replacement organization role ID. Exactly one role is required.',
    type: [String],
    example: ['b429b596-1865-4ace-bd6d-9ca3b52da710'],
    minItems: 1,
    maxItems: 1,
  })
  @IsArray({ message: 'Role IDs must be an array' })
  @ArrayMinSize(1, {
    message: 'Select one role for this member',
  })
  @ArrayMaxSize(1, {
    message: 'Only one role can be assigned to a user',
  })
  @ArrayUnique({ message: 'Role IDs must be unique' })
  @IsUUID('4', {
    each: true,
    message: 'Each role ID must be a valid UUID',
  })
  roleIds!: string[];
}
