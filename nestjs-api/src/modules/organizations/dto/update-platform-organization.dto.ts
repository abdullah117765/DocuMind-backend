import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { OrganizationStatus } from '../../../generated/prisma/client';
import { UpdateOrganizationSettingsDto } from './update-organization-settings.dto';

export class UpdatePlatformOrganizationDto extends UpdateOrganizationSettingsDto {
  @ApiPropertyOptional({
    description: 'Platform-level tenant availability',
    enum: OrganizationStatus,
    example: OrganizationStatus.ACTIVE,
  })
  @IsOptional()
  @IsEnum(OrganizationStatus, { message: 'Organization status is invalid' })
  status?: OrganizationStatus;
}
