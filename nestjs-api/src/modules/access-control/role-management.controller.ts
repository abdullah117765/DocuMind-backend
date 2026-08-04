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
import { CreateRoleDto } from './dto/create-role.dto';
import { OrganizationIdDto } from './dto/organization-id.dto';
import { OrganizationRoleParamsDto } from './dto/organization-role-params.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import {
  PermissionView,
  RoleManagementService,
  RoleView,
} from './role-management.service';
import { ORGANIZATION_PERMISSIONS } from './rbac.constants';

interface PermissionListResult {
  data: {
    permissions: PermissionView[];
  };
}

interface RoleListResult {
  data: {
    roles: RoleView[];
  };
}

interface RoleResult {
  data: {
    role: RoleView;
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

@ApiTags('Role Management')
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
    'The user does not have roles.manage permission in this organization',
})
@RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.rolesManage)
@Controller('organizations/:organizationId')
export class RoleManagementController {
  constructor(private readonly roleManagementService: RoleManagementService) {}

  @Get('permissions')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List active permissions available to organization roles',
  })
  @ApiOkResponse({ description: 'Organization permission catalog' })
  async listPermissions(): Promise<PermissionListResult> {
    return {
      data: {
        permissions: await this.roleManagementService.listPermissions(),
      },
    };
  }

  @Get('roles')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'List system and custom roles available in an organization',
  })
  @ApiOkResponse({ description: 'Available organization roles' })
  async listRoles(@Param() params: OrganizationIdDto): Promise<RoleListResult> {
    return {
      data: {
        roles: await this.roleManagementService.listRoles(
          params.organizationId,
        ),
      },
    };
  }

  @Get('roles/:roleId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'roleId',
    description: 'Role identifier',
    format: 'uuid',
  })
  @ApiOperation({ summary: 'Get one organization role' })
  @ApiOkResponse({ description: 'Role details and effective permissions' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  async getRole(
    @Param() params: OrganizationRoleParamsDto,
  ): Promise<RoleResult> {
    return {
      data: {
        role: await this.roleManagementService.getRole(
          params.organizationId,
          params.roleId,
        ),
      },
    };
  }

  @Post('roles')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.rolesManage,
    ORGANIZATION_PERMISSIONS.permissionsAssign,
  )
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({ summary: 'Create a custom organization role' })
  @ApiCreatedResponse({ description: 'Custom role created' })
  @ApiBadRequestResponse({
    description: 'Input or permission-code validation failed',
  })
  @ApiConflictResponse({
    description: 'A role with the same normalized name already exists',
  })
  async createRole(
    @Param() params: OrganizationIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: CreateRoleDto,
  ): Promise<RoleResult> {
    return {
      data: {
        role: await this.roleManagementService.createRole(
          params.organizationId,
          principal.userId,
          dto,
        ),
      },
    };
  }

  @Patch('roles/:roleId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'roleId',
    description: 'Custom role identifier',
    format: 'uuid',
  })
  @UseGuards(CsrfGuard)
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({ summary: 'Update a custom organization role' })
  @ApiOkResponse({ description: 'Custom role updated' })
  @ApiBadRequestResponse({ description: 'Role input validation failed' })
  @ApiConflictResponse({
    description: 'A role with the same normalized name already exists',
  })
  @ApiForbiddenResponse({ description: 'System roles are immutable' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  async updateRole(
    @Param() params: OrganizationRoleParamsDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: UpdateRoleDto,
  ): Promise<RoleResult> {
    return {
      data: {
        role: await this.roleManagementService.updateRole(
          params.organizationId,
          params.roleId,
          principal.userId,
          dto,
        ),
      },
    };
  }

  @Put('roles/:roleId/permissions')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'roleId',
    description: 'Custom role identifier',
    format: 'uuid',
  })
  @UseGuards(CsrfGuard)
  @RequireOrganizationPermissions(
    ORGANIZATION_PERMISSIONS.rolesManage,
    ORGANIZATION_PERMISSIONS.permissionsAssign,
  )
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({
    summary: 'Replace every permission assigned to a custom role',
  })
  @ApiOkResponse({ description: 'Role permissions replaced atomically' })
  @ApiBadRequestResponse({
    description: 'One or more permission codes are invalid or inactive',
  })
  @ApiForbiddenResponse({ description: 'System roles are immutable' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  async replaceRolePermissions(
    @Param() params: OrganizationRoleParamsDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: UpdateRolePermissionsDto,
  ): Promise<RoleResult> {
    return {
      data: {
        role: await this.roleManagementService.replaceRolePermissions(
          params.organizationId,
          params.roleId,
          principal.userId,
          dto.permissionCodes,
        ),
      },
    };
  }

  @Delete('roles/:roleId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'roleId',
    description: 'Custom role identifier',
    format: 'uuid',
  })
  @UseGuards(CsrfGuard)
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({
    summary: 'Deactivate a custom role and revoke its member assignments',
  })
  @ApiOkResponse({ description: 'Custom role deleted' })
  @ApiForbiddenResponse({ description: 'System roles are immutable' })
  @ApiNotFoundResponse({ description: 'Role not found' })
  async deleteRole(
    @Param() params: OrganizationRoleParamsDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<ActionResult> {
    await this.roleManagementService.deleteRole(
      params.organizationId,
      params.roleId,
      principal.userId,
    );

    return {
      message: 'Role deleted successfully',
    };
  }
}
