import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  RequireAnyOrganizationPermission,
  RequirePlatformSuperAdmin,
} from '../../common/decorators/require-permissions.decorator';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { OrganizationIdDto } from '../access-control/dto/organization-id.dto';
import { ORGANIZATION_PERMISSIONS } from '../access-control/rbac.constants';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationSettingsDto } from './dto/update-organization-settings.dto';
import { UpdatePlatformOrganizationDto } from './dto/update-platform-organization.dto';
import {
  OrganizationsService,
  PlatformOrganizationView,
} from './organizations.service';

interface OrganizationListResult {
  data: {
    organizations: PlatformOrganizationView[];
  };
}

interface OrganizationResult {
  data: {
    organization: PlatformOrganizationView;
  };
}

interface ActionResult {
  message: string;
}

@ApiTags('Platform Organizations')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access-cookie')
@ApiUnauthorizedResponse({
  description: 'Access token is missing, invalid, or expired',
})
@ApiForbiddenResponse({
  description: 'The user is not a platform Super Admin',
})
@RequirePlatformSuperAdmin()
@Controller('platform/organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List tenant organizations visible to platform administrators',
  })
  @ApiOkResponse({ description: 'Tenant organizations' })
  async listOrganizations(): Promise<OrganizationListResult> {
    return {
      data: {
        organizations: await this.organizationsService.listOrganizations(),
      },
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'x-csrf-token',
    required: true,
    description: 'Token returned by GET /auth/csrf',
  })
  @ApiBody({ type: CreateOrganizationDto })
  @ApiOperation({
    summary: 'Create a tenant organization as a platform administrator',
  })
  @ApiCreatedResponse({
    description:
      'Organization created with default subscription and limits. Platform Super Admin remains outside tenant membership.',
  })
  @ApiConflictResponse({
    description: 'Organization slug is already in use',
  })
  async createOrganization(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: CreateOrganizationDto,
  ): Promise<OrganizationResult> {
    return {
      data: {
        organization: await this.organizationsService.createOrganization(
          principal.userId,
          dto,
        ),
      },
    };
  }

  @Patch(':organizationId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'x-csrf-token',
    required: true,
    description: 'Token returned by GET /auth/csrf',
  })
  @ApiBody({ type: UpdatePlatformOrganizationDto })
  @ApiOperation({
    summary: 'Update, suspend, or reactivate a tenant organization',
  })
  @ApiOkResponse({ description: 'Tenant organization updated' })
  async updatePlatformOrganization(
    @Param() params: OrganizationIdDto,
    @Body() dto: UpdatePlatformOrganizationDto,
  ): Promise<OrganizationResult> {
    return {
      data: {
        organization: await this.organizationsService.updatePlatformOrganization(
          params.organizationId,
          dto,
        ),
      },
    };
  }

  @Delete(':organizationId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'x-csrf-token',
    required: true,
    description: 'Token returned by GET /auth/csrf',
  })
  @ApiOperation({ summary: 'Delete a tenant organization as Super Admin' })
  @ApiOkResponse({ description: 'Tenant organization deleted' })
  async deleteOrganization(
    @Param() params: OrganizationIdDto,
  ): Promise<ActionResult> {
    await this.organizationsService.deleteOrganization(params.organizationId);

    return { message: 'Organization deleted.' };
  }
}

@ApiTags('Organization Settings')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access-cookie')
@Controller('organizations/:organizationId/settings')
export class OrganizationSettingsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequireAnyOrganizationPermission(ORGANIZATION_PERMISSIONS.settingsManage)
  @ApiOperation({ summary: 'Get organization settings' })
  @ApiOkResponse({ description: 'Organization settings' })
  async getOrganizationSettings(
    @Param() params: OrganizationIdDto,
  ): Promise<OrganizationResult> {
    return {
      data: {
        organization: await this.organizationsService.getOrganization(
          params.organizationId,
        ),
      },
    };
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @RequireAnyOrganizationPermission(ORGANIZATION_PERMISSIONS.settingsManage)
  @ApiHeader({
    name: 'x-csrf-token',
    required: true,
    description: 'Token returned by GET /auth/csrf',
  })
  @ApiBody({ type: UpdateOrganizationSettingsDto })
  @ApiOperation({ summary: 'Update organization profile settings' })
  @ApiOkResponse({ description: 'Organization settings updated' })
  async updateOrganizationSettings(
    @Param() params: OrganizationIdDto,
    @Body() dto: UpdateOrganizationSettingsDto,
  ): Promise<OrganizationResult> {
    return {
      data: {
        organization: await this.organizationsService.updateOrganizationSettings(
          params.organizationId,
          dto,
        ),
      },
    };
  }
}
