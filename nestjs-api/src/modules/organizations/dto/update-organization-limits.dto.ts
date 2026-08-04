import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateOrganizationLimitsDto {
  @ApiPropertyOptional({ example: 25, minimum: 1, maximum: 100000 })
  @IsOptional()
  @IsInt({ message: 'Maximum members must be an integer' })
  @Min(1, { message: 'Maximum members must be at least 1' })
  @Max(100000, { message: 'Maximum members is too high' })
  maxMembers?: number;

  @ApiPropertyOptional({ example: 10000, minimum: 0, maximum: 100000000 })
  @IsOptional()
  @IsInt({ message: 'Maximum documents must be an integer' })
  @Min(0, { message: 'Maximum documents must be at least 0' })
  @Max(100000000, { message: 'Maximum documents is too high' })
  maxDocuments?: number;

  @ApiPropertyOptional({ example: 10240, minimum: 0, maximum: 100000000 })
  @IsOptional()
  @IsInt({ message: 'Maximum storage must be an integer' })
  @Min(0, { message: 'Maximum storage must be at least 0' })
  @Max(100000000, { message: 'Maximum storage is too high' })
  maxStorageMb?: number;

  @ApiPropertyOptional({ example: 50000, minimum: 0, maximum: 100000000 })
  @IsOptional()
  @IsInt({ message: 'Maximum monthly AI requests must be an integer' })
  @Min(0, { message: 'Maximum monthly AI requests must be at least 0' })
  @Max(100000000, { message: 'Maximum monthly AI requests is too high' })
  maxMonthlyAiRequests?: number;
}
