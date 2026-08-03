import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { RequirePlatformPermissions } from '../../common/decorators/require-permissions.decorator';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import { CreateOrganizationDto } from './dto/create-organization.dto';
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

const PLATFORM_ORGANIZATION_PERMISSION = 'platform.organizations.manage';

@ApiTags('Platform Organizations')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access-cookie')
@ApiUnauthorizedResponse({
  description: 'Access token is missing, invalid, or expired',
})
@ApiForbiddenResponse({
  description: 'The user is not a platform Super Admin',
})
@RequirePlatformPermissions(PLATFORM_ORGANIZATION_PERMISSION)
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
      'Organization created and the creator assigned organization admin access',
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
}
