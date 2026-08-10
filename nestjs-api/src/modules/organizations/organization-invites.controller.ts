import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireOrganizationPermissions } from '../../common/decorators/require-permissions.decorator';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import { OrganizationIdDto } from '../access-control/dto/organization-id.dto';
import { ORGANIZATION_PERMISSIONS } from '../access-control/rbac.constants';
import { InviteOrganizationMemberDto } from './dto/invite-organization-member.dto';
import { ListOrganizationInvitesQueryDto } from './dto/list-organization-invites-query.dto';
import { OrganizationInviteParamsDto } from './dto/organization-invite-params.dto';
import { RevokeOrganizationInviteDto } from './dto/revoke-organization-invite.dto';
import {
  OrganizationInviteListResult,
  OrganizationInviteView,
  OrganizationInvitesService,
} from './organization-invites.service';

interface InviteListResult {
  data: {
    invites: OrganizationInviteView[];
    pagination: OrganizationInviteListResult['pagination'];
  };
}

interface InviteResult {
  data: {
    invite: OrganizationInviteView;
  };
}

@ApiTags('Organization Invites')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access-cookie')
@RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.membersManage)
@Controller('organizations/:organizationId/invites')
export class OrganizationInvitesController {
  constructor(private readonly invitesService: OrganizationInvitesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List organization invitations' })
  @ApiOkResponse({ description: 'Organization invitations' })
  async listInvites(
    @Param() params: OrganizationIdDto,
    @Query() query: ListOrganizationInvitesQueryDto,
  ): Promise<InviteListResult> {
    const result = await this.invitesService.listInvites(
      params.organizationId,
      query,
    );

    return {
      data: {
        invites: result.invites,
        pagination: result.pagination,
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
  @ApiBody({ type: InviteOrganizationMemberDto })
  @ApiOperation({ summary: 'Invite a member by email' })
  async inviteMember(
    @Param() params: OrganizationIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: InviteOrganizationMemberDto,
  ): Promise<InviteResult> {
    return {
      data: {
        invite: await this.invitesService.inviteMember(
          params.organizationId,
          principal,
          dto,
        ),
      },
    };
  }

  @Delete(':inviteId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'x-csrf-token',
    required: true,
    description: 'Token returned by GET /auth/csrf',
  })
  @ApiOperation({ summary: 'Revoke a pending organization invitation' })
  async revokeInvite(
    @Param() params: OrganizationInviteParamsDto,
    @Body() dto: RevokeOrganizationInviteDto,
  ): Promise<InviteResult & { message: string }> {
    const invite = await this.invitesService.revokeInvite(
      params.organizationId,
      params.inviteId,
      dto.revocationReason,
    );

    return {
      data: { invite },
      message: 'Invitation revoked successfully',
    };
  }

  @Post(':inviteId/resend')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'x-csrf-token',
    required: true,
    description: 'Token returned by GET /auth/csrf',
  })
  @ApiOperation({ summary: 'Resend a pending or expired organization invite' })
  async resendInvite(
    @Param() params: OrganizationInviteParamsDto,
  ): Promise<InviteResult> {
    return {
      data: {
        invite: await this.invitesService.resendInvite(
          params.organizationId,
          params.inviteId,
        ),
      },
    };
  }
}
