import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsUUID } from 'class-validator';

export class ReplacePlatformRolesDto {
  @ApiProperty({
    description: 'Platform role IDs assigned to the user',
    type: [String],
  })
  @IsArray({ message: 'Role IDs must be an array' })
  @ArrayMaxSize(25, { message: 'No more than 25 roles can be assigned' })
  @IsUUID('4', { each: true, message: 'Each role ID must be a valid UUID' })
  roleIds!: string[];
}
