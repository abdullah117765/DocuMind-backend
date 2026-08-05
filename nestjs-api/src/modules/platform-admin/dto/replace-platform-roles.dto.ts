import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class ReplacePlatformRolesDto {
  @ApiProperty({
    description: 'Platform role ID assigned to the user',
    type: [String],
    minItems: 1,
    maxItems: 1,
  })
  @IsArray({ message: 'Role IDs must be an array' })
  @ArrayMinSize(1, { message: 'Select one platform role' })
  @ArrayMaxSize(1, { message: 'Only one role can be assigned to a user' })
  @IsUUID('4', { each: true, message: 'Each role ID must be a valid UUID' })
  roleIds!: string[];
}
