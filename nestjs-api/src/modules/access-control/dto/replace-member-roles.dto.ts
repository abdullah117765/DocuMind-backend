import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReplaceMemberRolesDto {
  @ApiProperty({
    description:
      'Complete replacement set of applicable organization role IDs; an empty array removes every role',
    type: [String],
    example: ['b429b596-1865-4ace-bd6d-9ca3b52da710'],
    maxItems: 20,
  })
  @IsArray({ message: 'Role IDs must be an array' })
  @ArrayMaxSize(20, {
    message: 'A member cannot have more than 20 roles',
  })
  @ArrayUnique({ message: 'Role IDs must be unique' })
  @IsUUID('4', {
    each: true,
    message: 'Each role ID must be a valid UUID',
  })
  roleIds!: string[];
}
