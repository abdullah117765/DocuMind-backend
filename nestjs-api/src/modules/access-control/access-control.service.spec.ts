import { AccessScope, OrganizationStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EnvSuperAdminService } from '../auth/env-super-admin.service';
import { AccessControlCacheService } from './access-control-cache.service';
import { AccessControlService } from './access-control.service';
import { OrganizationAccess, PlatformAccess } from './access-control.types';

describe('AccessControlService', () => {
  const platformRoleFindMany = jest.fn();
  const organizationFindUnique = jest.fn();
  const membershipFindFirst = jest.fn();
  const getOrganizationAccess = jest.fn();
  const getPlatformAccess = jest.fn();
  const invalidateAll = jest.fn();
  const invalidateOrganization = jest.fn();
  const invalidateUser = jest.fn();
  const setOrganizationAccess = jest.fn();
  const setPlatformAccess = jest.fn();
  const isConfiguredSuperAdminUserId = jest.fn();
  const getSuperAdminVirtualRole = jest.fn();
  const listSuperAdminPermissionCodes = jest.fn();
  const prisma = {
    platformUserRole: {
      findMany: platformRoleFindMany,
    },
    organization: {
      findUnique: organizationFindUnique,
    },
    organizationMembership: {
      findFirst: membershipFindFirst,
    },
  } as unknown as PrismaService;
  const cache = {
    getOrganizationAccess,
    getPlatformAccess,
    invalidateAll,
    invalidateOrganization,
    invalidateUser,
    setOrganizationAccess,
    setPlatformAccess,
  } as unknown as AccessControlCacheService;
  const envSuperAdminService = {
    isConfiguredUserId: isConfiguredSuperAdminUserId,
    getVirtualRole: getSuperAdminVirtualRole,
    listActivePermissionCodes: listSuperAdminPermissionCodes,
  } as unknown as EnvSuperAdminService;
  const service = new AccessControlService(prisma, cache, envSuperAdminService);
  const stamp = {
    globalVersion: '0',
    userVersion: '0',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getPlatformAccess.mockResolvedValue({ stamp, value: null });
    getOrganizationAccess.mockResolvedValue({
      stamp: {
        ...stamp,
        organizationVersion: '0',
      },
      value: null,
    });
    setPlatformAccess.mockResolvedValue(true);
    setOrganizationAccess.mockResolvedValue(true);
    invalidateAll.mockResolvedValue();
    invalidateOrganization.mockResolvedValue();
    invalidateUser.mockResolvedValue();
    platformRoleFindMany.mockResolvedValue([]);
    organizationFindUnique.mockResolvedValue({
      id: 'organization-1',
      status: OrganizationStatus.ACTIVE,
    });
    membershipFindFirst.mockResolvedValue(null);
    isConfiguredSuperAdminUserId.mockResolvedValue(false);
    getSuperAdminVirtualRole.mockReturnValue(null);
    listSuperAdminPermissionCodes.mockResolvedValue([]);
  });

  it('returns cached platform access without querying PostgreSQL', async () => {
    const cached: PlatformAccess = {
      userId: 'user-1',
      roles: [],
      permissions: [],
    };
    getPlatformAccess.mockResolvedValue({ stamp, value: cached });

    await expect(service.resolvePlatformAccess('user-1')).resolves.toBe(cached);
    expect(platformRoleFindMany).not.toHaveBeenCalled();
  });

  it('resolves, deduplicates, sorts, and caches platform permissions', async () => {
    platformRoleFindMany.mockResolvedValue([
      {
        role: {
          id: 'role-2',
          name: 'Security Admin',
          scope: AccessScope.PLATFORM,
          permissions: [
            { permission: { code: 'platform.users.manage' } },
            { permission: { code: 'platform.audit.view' } },
          ],
        },
      },
      {
        role: {
          id: 'role-1',
          name: 'Audit Admin',
          scope: AccessScope.PLATFORM,
          permissions: [{ permission: { code: 'platform.audit.view' } }],
        },
      },
    ]);

    const result = await service.resolvePlatformAccess('user-1');

    expect(result).toEqual({
      userId: 'user-1',
      roles: [
        {
          id: 'role-1',
          name: 'Audit Admin',
          scope: AccessScope.PLATFORM,
        },
        {
          id: 'role-2',
          name: 'Security Admin',
          scope: AccessScope.PLATFORM,
        },
      ],
      permissions: ['platform.audit.view', 'platform.users.manage'],
    });
    expect(setPlatformAccess).toHaveBeenCalledWith('user-1', stamp, result);
    expect(platformRoleFindMany).toHaveBeenCalledTimes(1);
  });

  it('returns cached organization access without querying PostgreSQL', async () => {
    const cached: OrganizationAccess = {
      userId: 'user-1',
      organizationId: 'organization-1',
      membershipId: null,
      roles: [],
      permissions: [],
    };
    getOrganizationAccess.mockResolvedValue({
      stamp: {
        ...stamp,
        organizationVersion: '0',
      },
      value: cached,
    });

    await expect(
      service.resolveOrganizationAccess('user-1', 'organization-1'),
    ).resolves.toBe(cached);
    expect(organizationFindUnique).not.toHaveBeenCalled();
  });

  it('returns null and does not cache access for a missing organization', async () => {
    organizationFindUnique.mockResolvedValue(null);

    await expect(
      service.resolveOrganizationAccess('user-1', 'missing-organization'),
    ).resolves.toBeNull();
    expect(setOrganizationAccess).not.toHaveBeenCalled();
  });

  it('returns null and does not cache access for a suspended organization', async () => {
    organizationFindUnique.mockResolvedValue({
      id: 'organization-1',
      status: OrganizationStatus.SUSPENDED,
    });

    await expect(
      service.resolveOrganizationAccess('user-1', 'organization-1'),
    ).resolves.toBeNull();
    expect(setOrganizationAccess).not.toHaveBeenCalled();
  });

  it('merges platform and membership permissions for an organization', async () => {
    platformRoleFindMany.mockResolvedValue([
      {
        role: {
          id: 'role-platform',
          name: 'Super Admin',
          scope: AccessScope.PLATFORM,
          permissions: [
            { permission: { code: 'documents.delete' } },
            { permission: { code: 'documents.read' } },
          ],
        },
      },
    ]);
    membershipFindFirst.mockResolvedValue({
      id: 'membership-1',
      roles: [
        {
          role: {
            id: 'role-manager',
            name: 'Manager',
            scope: AccessScope.ORGANIZATION,
            permissions: [
              { permission: { code: 'documents.read' } },
              { permission: { code: 'documents.update' } },
            ],
          },
        },
      ],
    });

    const result = await service.resolveOrganizationAccess(
      'user-1',
      'organization-1',
    );

    expect(result).toEqual({
      userId: 'user-1',
      organizationId: 'organization-1',
      membershipId: 'membership-1',
      roles: [
        {
          id: 'role-manager',
          name: 'Manager',
          scope: AccessScope.ORGANIZATION,
        },
        {
          id: 'role-platform',
          name: 'Super Admin',
          scope: AccessScope.PLATFORM,
        },
      ],
      permissions: ['documents.delete', 'documents.read', 'documents.update'],
    });
    expect(setOrganizationAccess).toHaveBeenCalledWith(
      'user-1',
      'organization-1',
      {
        ...stamp,
        organizationVersion: '0',
      },
      result,
    );
  });

  it('returns platform organization permissions without a membership', async () => {
    platformRoleFindMany.mockResolvedValue([
      {
        role: {
          id: 'role-platform',
          name: 'Super Admin',
          scope: AccessScope.PLATFORM,
          permissions: [{ permission: { code: 'documents.read' } }],
        },
      },
    ]);

    await expect(
      service.resolveOrganizationAccess('user-1', 'organization-1'),
    ).resolves.toEqual(
      expect.objectContaining({
        membershipId: null,
        permissions: ['documents.read'],
      }),
    );
  });

  it('delegates targeted and catalog-wide invalidation', async () => {
    await service.invalidateUserAccess('user-1');
    await service.invalidateOrganizationAccess('organization-1');
    await service.invalidateRoleAccess();
    await service.invalidatePermissionAccess();
    await service.invalidateAllAccess();

    expect(invalidateUser).toHaveBeenCalledWith('user-1');
    expect(invalidateOrganization).toHaveBeenCalledWith('organization-1');
    expect(invalidateAll).toHaveBeenCalledTimes(3);
  });
});
