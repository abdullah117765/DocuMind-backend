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
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireOrganizationPermissions } from '../../common/decorators/require-permissions.decorator';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import { AddOrganizationMemberDto } from './dto/add-organization-member.dto';
import { OrganizationIdDto } from './dto/organization-id.dto';
import { OrganizationMemberParamsDto } from './dto/organization-member-params.dto';
import { ReplaceMemberRolesDto } from './dto/replace-member-roles.dto';
import { UpdateMemberStatusDto } from './dto/update-member-status.dto';
import {
  OrganizationMembersService,
  OrganizationMemberView,
} from './organization-members.service';

interface MemberListResult {
  data: {
    members: OrganizationMemberView[];
  };
}

interface MemberResult {
  data: {
    member: OrganizationMemberView;
  };
}

interface ActionResult {
  message: string;
}

const CSRF_HEADER = {
  name: 'x-csrf-token',
  required: true,
  description: 'Token returned by GET /auth/csrf',
} as const;

const MEMBERSHIP_ID_PARAM = {
  name: 'membershipId',
  description: 'Organization membership identifier',
  format: 'uuid',
  example: '58e00226-8217-40cc-aa59-f8e688cdcc52',
} as const;

@ApiTags('Organization Members')
@ApiParam({
  name: 'organizationId',
  description: 'Organization identifier',
  format: 'uuid',
  example: '3c84ea89-6b30-4d90-a444-c12ba29777fb',
})
@ApiBearerAuth('access-token')
@ApiCookieAuth('access-cookie')
@ApiUnauthorizedResponse({
  description: 'Access token is missing, invalid, or expired',
})
@ApiForbiddenResponse({
  description:
    'The user does not have users.manage permission in this organization',
})
@RequireOrganizationPermissions('users.manage')
@Controller('organizations/:organizationId/members')
export class OrganizationMembersController {
  constructor(
    private readonly organizationMembersService: OrganizationMembersService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List current organization members' })
  @ApiOkResponse({ description: 'Active and suspended organization members' })
  async listMembers(
    @Param() params: OrganizationIdDto,
  ): Promise<MemberListResult> {
    return {
      data: {
        members: await this.organizationMembersService.listMembers(
          params.organizationId,
        ),
      },
    };
  }

  @Get(':membershipId')
  @HttpCode(HttpStatus.OK)
  @ApiParam(MEMBERSHIP_ID_PARAM)
  @ApiOperation({ summary: 'Get one current organization member' })
  @ApiOkResponse({ description: 'Organization member and assigned roles' })
  @ApiNotFoundResponse({ description: 'Organization member not found' })
  async getMember(
    @Param() params: OrganizationMemberParamsDto,
  ): Promise<MemberResult> {
    return {
      data: {
        member: await this.organizationMembersService.getMember(
          params.organizationId,
          params.membershipId,
        ),
      },
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({
    summary: 'Add an existing verified user to an organization',
  })
  @ApiCreatedResponse({ description: 'Organization member added' })
  @ApiBadRequestResponse({
    description: 'Input or initial role validation failed',
  })
  @ApiConflictResponse({
    description: 'User is already a current organization member',
  })
  @ApiNotFoundResponse({ description: 'Verified user not found' })
  async addMember(
    @Param() params: OrganizationIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: AddOrganizationMemberDto,
  ): Promise<MemberResult> {
    return {
      data: {
        member: await this.organizationMembersService.addMember(
          params.organizationId,
          principal.userId,
          dto,
        ),
      },
    };
  }

  @Put(':membershipId/roles')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiHeader(CSRF_HEADER)
  @ApiParam(MEMBERSHIP_ID_PARAM)
  @ApiOperation({
    summary: 'Replace every organization role assigned to a member',
  })
  @ApiOkResponse({ description: 'Member roles replaced atomically' })
  @ApiBadRequestResponse({
    description: 'One or more roles are invalid, inactive, or unavailable',
  })
  @ApiConflictResponse({
    description: 'The change would remove the final user manager',
  })
  @ApiNotFoundResponse({ description: 'Organization member not found' })
  async replaceMemberRoles(
    @Param() params: OrganizationMemberParamsDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: ReplaceMemberRolesDto,
  ): Promise<MemberResult> {
    return {
      data: {
        member: await this.organizationMembersService.replaceMemberRoles(
          params.organizationId,
          params.membershipId,
          principal.userId,
          dto.roleIds,
        ),
      },
    };
  }

  @Patch(':membershipId/status')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiHeader(CSRF_HEADER)
  @ApiParam(MEMBERSHIP_ID_PARAM)
  @ApiOperation({
    summary: 'Suspend or reactivate an organization member',
  })
  @ApiOkResponse({ description: 'Member status updated' })
  @ApiConflictResponse({
    description: 'The change would suspend the final user manager',
  })
  @ApiNotFoundResponse({ description: 'Organization member not found' })
  async updateMemberStatus(
    @Param() params: OrganizationMemberParamsDto,
    @Body() dto: UpdateMemberStatusDto,
  ): Promise<MemberResult> {
    return {
      data: {
        member: await this.organizationMembersService.updateMemberStatus(
          params.organizationId,
          params.membershipId,
          dto.status,
        ),
      },
    };
  }

  @Delete(':membershipId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiHeader(CSRF_HEADER)
  @ApiParam(MEMBERSHIP_ID_PARAM)
  @ApiOperation({
    summary: 'Remove a member and revoke every organization role',
  })
  @ApiOkResponse({ description: 'Organization member removed' })
  @ApiConflictResponse({
    description: 'The change would remove the final user manager',
  })
  @ApiNotFoundResponse({ description: 'Organization member not found' })
  async removeMember(
    @Param() params: OrganizationMemberParamsDto,
  ): Promise<ActionResult> {
    await this.organizationMembersService.removeMember(
      params.organizationId,
      params.membershipId,
    );

    return {
      message: 'Organization member removed successfully',
    };
  }
}
