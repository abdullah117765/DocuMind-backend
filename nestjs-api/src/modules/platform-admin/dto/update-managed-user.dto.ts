import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateManagedUserDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean({ message: 'Active must be true or false' })
  isActive?: boolean;
}
