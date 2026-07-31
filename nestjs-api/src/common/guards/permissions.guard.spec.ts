import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessScope } from '../../generated/prisma/client';
import { AccessControlService } from '../../modules/access-control/access-control.service';
import {
  PermissionMatch,
  PermissionRequirement,
} from '../../modules/access-control/permission-requirement';
import { AuthorizedRequest, PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  const organizationId = '3c84ea89-6b30-4d90-a444-c12ba29777fb';
  const request = {
    params: {},
    user: {
      userId: 'user-1',
    },
  } as unknown as AuthorizedRequest;
  const getAllAndOverride = jest.fn();
  const reflector = {
    getAllAndOverride,
  } as unknown as Reflector;
  const resolvePlatformAccess = jest.fn();
  const resolveOrganizationAccess = jest.fn();
  const accessControlService = {
    resolvePlatformAccess,
    resolveOrganizationAccess,
  } as unknown as AccessControlService;
  const context = {
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
  const guard = new PermissionsGuard(reflector, accessControlService);

  beforeEach(() => {
    jest.clearAllMocks();
    request.params = {};
    request.user = {
      userId: 'user-1',
      email: 'user@example.com',
      isVerified: true,
      sessionId: 'session-1',
      tokenId: 'token-1',
    };
    delete request.authorizedAccess;
  });

  it('does nothing when a route has no permission requirement', async () => {
    getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(resolvePlatformAccess).not.toHaveBeenCalled();
    expect(resolveOrganizationAccess).not.toHaveBeenCalled();
  });

  it('rejects a protected route without an authenticated principal', async () => {
    getAllAndOverride.mockReturnValue(platformRequirement('billing.manage'));
    request.user = undefined;

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('allows platform access when every required permission is granted', async () => {
    getAllAndOverride.mockReturnValue(
      platformRequirement('billing.manage', 'users.manage'),
    );
    const access = {
      userId: 'user-1',
      roles: [],
      permissions: ['billing.manage', 'users.manage'],
    };
    resolvePlatformAccess.mockResolvedValue(access);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(resolvePlatformAccess).toHaveBeenCalledWith('user-1');
    expect(request.authorizedAccess).toBe(access);
  });

  it('rejects platform access when one required permission is missing', async () => {
    getAllAndOverride.mockReturnValue(
      platformRequirement('billing.manage', 'users.manage'),
    );
    resolvePlatformAccess.mockResolvedValue({
      userId: 'user-1',
      roles: [],
      permissions: ['billing.manage'],
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('supports any-permission matching', async () => {
    getAllAndOverride.mockReturnValue({
      ...platformRequirement('billing.manage', 'users.manage'),
      match: PermissionMatch.ANY,
    });
    resolvePlatformAccess.mockResolvedValue({
      userId: 'user-1',
      roles: [],
      permissions: ['users.manage'],
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('resolves organization access from the default route parameter', async () => {
    getAllAndOverride.mockReturnValue(
      organizationRequirement('documents.update'),
    );
    request.params = { organizationId };
    const access = {
      userId: 'user-1',
      organizationId,
      membershipId: 'membership-1',
      roles: [],
      permissions: ['documents.update'],
    };
    resolveOrganizationAccess.mockResolvedValue(access);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(resolveOrganizationAccess).toHaveBeenCalledWith(
      'user-1',
      organizationId,
    );
    expect(request.authorizedAccess).toBe(access);
  });

  it('supports a custom organization route parameter name', async () => {
    getAllAndOverride.mockReturnValue({
      ...organizationRequirement('documents.read'),
      organizationIdParam: 'orgId',
    });
    request.params = { orgId: organizationId };
    resolveOrganizationAccess.mockResolvedValue({
      userId: 'user-1',
      organizationId,
      membershipId: null,
      roles: [],
      permissions: ['documents.read'],
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a missing or malformed organization UUID before database access', async () => {
    getAllAndOverride.mockReturnValue(
      organizationRequirement('documents.read'),
    );
    request.params = { organizationId: 'not-a-uuid' };

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(resolveOrganizationAccess).not.toHaveBeenCalled();
  });

  it('does not reveal whether an inaccessible organization exists', async () => {
    getAllAndOverride.mockReturnValue(
      organizationRequirement('documents.read'),
    );
    request.params = { organizationId };
    resolveOrganizationAccess.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

function platformRequirement(
  ...permissionCodes: string[]
): PermissionRequirement {
  return {
    scope: AccessScope.PLATFORM,
    match: PermissionMatch.ALL,
    permissionCodes,
  };
}

function organizationRequirement(
  ...permissionCodes: string[]
): PermissionRequirement {
  return {
    scope: AccessScope.ORGANIZATION,
    match: PermissionMatch.ALL,
    permissionCodes,
    organizationIdParam: 'organizationId',
  };
}
