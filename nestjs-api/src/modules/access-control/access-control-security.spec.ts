import { GUARDS_METADATA } from '@nestjs/common/constants';
import { validate } from 'class-validator';
import { AccessScope } from '../../generated/prisma/client';
import {
  PERMISSION_REQUIREMENT_METADATA,
  PermissionMatch,
  PermissionRequirement,
} from './permission-requirement';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformSuperAdminGuard } from '../../common/guards/platform-super-admin.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { CurrentUserAccessController } from './current-user-access.controller';
import { OrganizationMembersController } from './organization-members.controller';
import {
  OrganizationSettingsController,
  OrganizationsController,
} from '../organizations/organizations.controller';
import { RoleManagementController } from './role-management.controller';
import { UpdateMemberStatusDto } from './dto/update-member-status.dto';
import { InviteAcceptanceController } from '../organizations/invite-acceptance.controller';
import { OrganizationInvitesController } from '../organizations/organization-invites.controller';

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
  it.each([
    [RoleManagementController, ['roles.manage']],
    [OrganizationInvitesController, ['members.manage']],
    [OrganizationMembersController, ['members.manage']],
  ])(
    'requires JWT and dynamic permission guards on %p',
    (controller, permissionCodes) => {
    expect(getGuards(controller)).toEqual([JwtAuthGuard, PermissionsGuard]);
    expect(
      Reflect.getMetadata(
        PERMISSION_REQUIREMENT_METADATA,
        controller,
      ) as PermissionRequirement,
    ).toEqual({
      scope: AccessScope.ORGANIZATION,
      permissionCodes,
      match: PermissionMatch.ALL,
      organizationIdParam: 'organizationId',
    });
  });

  it('requires Super Admin role to create tenant organizations', () => {
    expect(getGuards(OrganizationsController)).toEqual([
      JwtAuthGuard,
      PlatformSuperAdminGuard,
    ]);
    expect(
      Reflect.getMetadata(
        PERMISSION_REQUIREMENT_METADATA,
        OrganizationsController,
      ),
    ).toBeUndefined();
  });

  it.each([
    [RoleManagementController, 'createRole'],
    [RoleManagementController, 'updateRole'],
    [RoleManagementController, 'replaceRolePermissions'],
    [RoleManagementController, 'deleteRole'],
    [OrganizationMembersController, 'addMember'],
    [OrganizationMembersController, 'replaceMemberRoles'],
    [OrganizationMembersController, 'updateMemberStatus'],
    [OrganizationMembersController, 'removeMember'],
    [OrganizationInvitesController, 'inviteMember'],
    [OrganizationInvitesController, 'revokeInvite'],
    [OrganizationsController, 'createOrganization'],
    [OrganizationsController, 'updatePlatformOrganization'],
    [OrganizationsController, 'deleteOrganization'],
    [OrganizationSettingsController, 'updateOrganizationSettings'],
  ])('requires CSRF protection on %p.%s', (controller, methodName) => {
    expect(getGuards(getHandler(controller, methodName))).toContain(CsrfGuard);
  });

  it.each([
    [InviteAcceptanceController, 'acceptInvite'],
  ])('requires CSRF protection on %p.%s', (controller, methodName) => {
    expect(getGuards(getHandler(controller, methodName))).toContain(CsrfGuard);
  });

  it.each([
    [RoleManagementController, 'listPermissions'],
    [RoleManagementController, 'listRoles'],
    [RoleManagementController, 'getRole'],
    [OrganizationMembersController, 'listMembers'],
    [OrganizationMembersController, 'getMember'],
    [OrganizationInvitesController, 'listInvites'],
    [InviteAcceptanceController, 'previewInvite'],
    [OrganizationSettingsController, 'getOrganizationSettings'],
    [OrganizationsController, 'listOrganizations'],
  ])('does not require CSRF on read-only %p.%s', (controller, methodName) => {
    expect(getGuards(getHandler(controller, methodName))).not.toContain(
      CsrfGuard,
    );
  });

  it.each([
    [OrganizationsController, 'updatePlatformOrganization'],
    [OrganizationsController, 'deleteOrganization'],
  ])('requires Super Admin role for platform mutation %p.%s', (controller, methodName) => {
    const handler = getHandler(controller, methodName);
    const effectiveGuards = [...getGuards(controller), ...getGuards(handler)];

    expect(effectiveGuards).toEqual(
      expect.arrayContaining([
        JwtAuthGuard,
        PlatformSuperAdminGuard,
        CsrfGuard,
      ]),
    );
    expect(
      Reflect.getMetadata(PERMISSION_REQUIREMENT_METADATA, handler),
    ).toBeUndefined();
  });

  it.each([
    [OrganizationSettingsController, 'getOrganizationSettings'],
    [OrganizationSettingsController, 'updateOrganizationSettings'],
  ])('requires organization settings permission on %p.%s', (controller, methodName) => {
    const handler = getHandler(controller, methodName);

    expect(getGuards(handler)).toEqual(
      expect.arrayContaining([JwtAuthGuard, PermissionsGuard]),
    );
    expect(
      Reflect.getMetadata(
        PERMISSION_REQUIREMENT_METADATA,
        handler,
      ) as PermissionRequirement,
    ).toEqual({
      scope: AccessScope.ORGANIZATION,
      permissionCodes: ['settings.manage'],
      match: PermissionMatch.ANY,
      organizationIdParam: 'organizationId',
    });
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
