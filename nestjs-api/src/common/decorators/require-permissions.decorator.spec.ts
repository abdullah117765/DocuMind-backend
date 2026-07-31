import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AccessScope } from '../../generated/prisma/client';
import {
  PERMISSION_REQUIREMENT_METADATA,
  PermissionMatch,
  PermissionRequirement,
} from '../../modules/access-control/permission-requirement';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import {
  RequireAnyOrganizationPermission,
  RequirePermissions,
  RequirePlatformPermissions,
} from './require-permissions.decorator';

describe('permission decorators', () => {
  it('stores a normalized platform requirement and both security guards', () => {
    class TestController {
      @RequirePlatformPermissions(
        ' users.manage ',
        'billing.manage',
        'users.manage',
      )
      handler(this: void): void {}
    }

    const requirement = Reflect.getMetadata(
      PERMISSION_REQUIREMENT_METADATA,
      TestController.prototype.handler,
    ) as PermissionRequirement;
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      TestController.prototype.handler,
    ) as unknown[];

    expect(requirement).toEqual({
      scope: AccessScope.PLATFORM,
      match: PermissionMatch.ALL,
      permissionCodes: ['users.manage', 'billing.manage'],
    });
    expect(guards).toEqual([JwtAuthGuard, PermissionsGuard]);
  });

  it('configures any-permission organization matching', () => {
    class TestController {
      @RequireAnyOrganizationPermission('documents.read', 'analytics.view')
      handler(this: void): void {}
    }

    expect(
      Reflect.getMetadata(
        PERMISSION_REQUIREMENT_METADATA,
        TestController.prototype.handler,
      ),
    ).toEqual({
      scope: AccessScope.ORGANIZATION,
      match: PermissionMatch.ANY,
      permissionCodes: ['documents.read', 'analytics.view'],
      organizationIdParam: 'organizationId',
    });
  });

  it('supports a custom organization route parameter', () => {
    class TestController {
      @RequirePermissions(
        {
          scope: AccessScope.ORGANIZATION,
          organizationIdParam: 'orgId',
        },
        'documents.read',
      )
      handler(this: void): void {}
    }

    expect(
      Reflect.getMetadata(
        PERMISSION_REQUIREMENT_METADATA,
        TestController.prototype.handler,
      ),
    ).toMatchObject({
      organizationIdParam: 'orgId',
    });
  });

  it('rejects a decorator with no usable permission codes', () => {
    expect(() => RequirePlatformPermissions(' ', '')).toThrow(TypeError);
  });
});
