import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import {
  CurrentUserAccessService,
  CurrentUserAccessView,
  SelectedOrganizationAccessView,
} from './current-user-access.service';
import { OrganizationIdDto } from './dto/organization-id.dto';

interface CurrentUserAccessResult {
  data: {
    access: CurrentUserAccessView;
  };
}

interface SelectedOrganizationAccessResult {
  data: {
    organizationAccess: SelectedOrganizationAccessView;
  };
}

@ApiTags('Current User Access')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access-cookie')
@ApiUnauthorizedResponse({
  description: 'Access token is missing, invalid, or expired',
})
@UseGuards(JwtAuthGuard)
@Controller('access-control/me')
export class CurrentUserAccessController {
  constructor(
    private readonly currentUserAccessService: CurrentUserAccessService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Get current platform access and every non-removed organization membership',
  })
  @ApiOkResponse({
    description:
      'Platform roles and permissions, global-organization flag, and organization access',
  })
  async getCurrentUserAccess(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<CurrentUserAccessResult> {
    return {
      data: {
        access: await this.currentUserAccessService.getCurrentUserAccess(
          principal.userId,
        ),
      },
    };
  }

  @Get('organizations/:organizationId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'organizationId',
    description: 'Organization identifier',
    format: 'uuid',
    example: '3c84ea89-6b30-4d90-a444-c12ba29777fb',
  })
  @ApiOperation({
    summary: 'Resolve current effective access for one organization',
  })
  @ApiOkResponse({
    description: 'Organization metadata and merged platform/membership access',
  })
  @ApiNotFoundResponse({
    description:
      'The organization does not exist or the current user cannot access it',
  })
  async getSelectedOrganizationAccess(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Param() params: OrganizationIdDto,
  ): Promise<SelectedOrganizationAccessResult> {
    return {
      data: {
        organizationAccess:
          await this.currentUserAccessService.getSelectedOrganizationAccess(
            principal.userId,
            params.organizationId,
          ),
      },
    };
  }
}
