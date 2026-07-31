import { GUARDS_METADATA } from '@nestjs/common/constants';
import { validate } from 'class-validator';
import { AccessScope } from '../../generated/prisma/client';
import {
  PERMISSION_REQUIREMENT_METADATA,
  PermissionMatch,
  PermissionRequirement,
} from './permission-requirement';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUserAccessController } from './current-user-access.controller';
import { OrganizationMembersController } from './organization-members.controller';
import { RoleManagementController } from './role-management.controller';
import { UpdateMemberStatusDto } from './dto/update-member-status.dto';

type ControllerClass = {
  prototype: object;
};

function getHandler(controller: ControllerClass, methodName: string): object {
  const descriptor = Object.getOwnPropertyDescriptor(
    controller.prototype,
    methodName,
  );

  if (!descriptor || typeof descriptor.value !== 'function') {
    throw new Error(`Controller method ${methodName} was not found`);
  }

  return descriptor.value as object;
}

function getGuards(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[]) ?? [];
}

describe('Epic 2 security metadata', () => {
  it.each([RoleManagementController, OrganizationMembersController])(
    'requires JWT and dynamic permission guards on %p',
    (controller) => {
      expect(getGuards(controller)).toEqual([JwtAuthGuard, PermissionsGuard]);
      expect(
        Reflect.getMetadata(
          PERMISSION_REQUIREMENT_METADATA,
          controller,
        ) as PermissionRequirement,
      ).toEqual({
        scope: AccessScope.ORGANIZATION,
        permissionCodes: ['users.manage'],
        match: PermissionMatch.ALL,
        organizationIdParam: 'organizationId',
      });
    },
  );

  it.each([
    [RoleManagementController, 'createRole'],
    [RoleManagementController, 'updateRole'],
    [RoleManagementController, 'replaceRolePermissions'],
    [RoleManagementController, 'deleteRole'],
    [OrganizationMembersController, 'addMember'],
    [OrganizationMembersController, 'replaceMemberRoles'],
    [OrganizationMembersController, 'updateMemberStatus'],
    [OrganizationMembersController, 'removeMember'],
  ])('requires CSRF protection on %p.%s', (controller, methodName) => {
    expect(getGuards(getHandler(controller, methodName))).toEqual([CsrfGuard]);
  });

  it.each([
    [RoleManagementController, 'listPermissions'],
    [RoleManagementController, 'listRoles'],
    [RoleManagementController, 'getRole'],
    [OrganizationMembersController, 'listMembers'],
    [OrganizationMembersController, 'getMember'],
  ])('does not require CSRF on read-only %p.%s', (controller, methodName) => {
    expect(getGuards(getHandler(controller, methodName))).toEqual([]);
  });

  it('protects current-user access with JWT without requiring users.manage', () => {
    expect(getGuards(CurrentUserAccessController)).toEqual([JwtAuthGuard]);
    expect(
      Reflect.getMetadata(
        PERMISSION_REQUIREMENT_METADATA,
        CurrentUserAccessController,
      ),
    ).toBeUndefined();
  });

  it('rejects REMOVED through the suspend/reactivate status DTO', async () => {
    const dto = new UpdateMemberStatusDto();
    Object.assign(dto, { status: 'REMOVED' });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toHaveProperty('isIn');
  });
});
