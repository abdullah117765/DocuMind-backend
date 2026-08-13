import { NotFoundException } from '@nestjs/common';
import {
  AccessScope,
  OrganizationMembershipStatus,
  OrganizationStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EnvSuperAdminService } from '../auth/env-super-admin.service';
import { AccessControlService } from './access-control.service';
import { CurrentUserAccessService } from './current-user-access.service';

describe('CurrentUserAccessService', () => {
  const userId = '7ee81b20-3a9a-4303-b370-89abf77f1bfc';
  const organizationId = '3c84ea89-6b30-4d90-a444-c12ba29777fb';
  const membershipFindMany = jest.fn();
  const organizationFindMany = jest.fn();
  const organizationFindUnique = jest.fn();
  const prisma = {
    organizationMembership: {
      findMany: membershipFindMany,
    },
    organization: {
      findMany: organizationFindMany,
      findUnique: organizationFindUnique,
    },
  } as unknown as PrismaService;
  const resolvePlatformAccess = jest.fn();
  const resolveOrganizationAccess = jest.fn();
  const isConfiguredSuperAdminUserId = jest.fn();
  const accessControlService = {
    resolvePlatformAccess,
    resolveOrganizationAccess,
  } as unknown as AccessControlService;
  const envSuperAdminService = {
    isConfiguredUserId: isConfiguredSuperAdminUserId,
  } as unknown as EnvSuperAdminService;
  const service = new CurrentUserAccessService(
    prisma,
    accessControlService,
    envSuperAdminService,
  );
  const platformAccess = {
    userId,
    roles: [],
    permissions: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    membershipFindMany.mockResolvedValue([]);
    organizationFindMany.mockResolvedValue([]);
    organizationFindUnique.mockResolvedValue({
      id: organizationId,
      name: 'Example Organization',
      slug: 'example-organization',
    });
    resolvePlatformAccess.mockResolvedValue(platformAccess);
    resolveOrganizationAccess.mockResolvedValue(null);
    isConfiguredSuperAdminUserId.mockResolvedValue(false);
  });

  it('returns empty organization access for a user with no memberships', async () => {
    await expect(service.getCurrentUserAccess(userId)).resolves.toEqual({
      platform: platformAccess,
      hasGlobalOrganizationAccess: false,
      organizations: [],
    });
    expect(membershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId,
          status: {
            not: OrganizationMembershipStatus.REMOVED,
          },
          organization: {
            is: {
              status: OrganizationStatus.ACTIVE,
            },
          },
        },
      }),
    );
  });

  it('returns effective access for active and suspended memberships', async () => {
    const suspendedOrganizationId = 'a31fcdfd-9612-450d-bf18-4b4160ba4cc1';
    membershipFindMany.mockResolvedValue([
      {
        id: 'membership-active',
        status: OrganizationMembershipStatus.ACTIVE,
        organization: {
          id: organizationId,
          name: 'Example Organization',
          slug: 'example-organization',
        },
      },
      {
        id: 'membership-suspended',
        status: OrganizationMembershipStatus.SUSPENDED,
        organization: {
          id: suspendedOrganizationId,
          name: 'Suspended Organization',
          slug: 'suspended-organization',
        },
      },
    ]);
    organizationFindMany.mockResolvedValue([
      {
        id: organizationId,
        name: 'Example Organization',
        slug: 'example-organization',
      },
      {
        id: suspendedOrganizationId,
        name: 'Suspended Organization',
        slug: 'suspended-organization',
      },
    ]);
    resolveOrganizationAccess
      .mockResolvedValueOnce({
        userId,
        organizationId,
        membershipId: 'membership-active',
        roles: [
          {
            id: 'role-employee',
            name: 'Employee',
            scope: AccessScope.ORGANIZATION,
          },
        ],
        permissions: ['documents.read'],
      })
      .mockResolvedValueOnce({
        userId,
        organizationId: suspendedOrganizationId,
        membershipId: null,
        roles: [],
        permissions: [],
      });

    const result = await service.getCurrentUserAccess(userId);

    expect(result).toEqual({
      platform: platformAccess,
      hasGlobalOrganizationAccess: false,
      organizations: [
        {
          organization: {
            id: organizationId,
            name: 'Example Organization',
            slug: 'example-organization',
          },
          membership: {
            id: 'membership-active',
            status: OrganizationMembershipStatus.ACTIVE,
          },
          roles: [
            {
              id: 'role-employee',
              name: 'Employee',
              scope: AccessScope.ORGANIZATION,
            },
          ],
          permissions: ['documents.read'],
        },
        {
          organization: {
            id: suspendedOrganizationId,
            name: 'Suspended Organization',
            slug: 'suspended-organization',
          },
          membership: {
            id: 'membership-suspended',
            status: OrganizationMembershipStatus.SUSPENDED,
          },
          roles: [],
          permissions: [],
        },
      ],
    });
    expect(resolveOrganizationAccess).toHaveBeenNthCalledWith(
      1,
      userId,
      organizationId,
    );
    expect(resolveOrganizationAccess).toHaveBeenNthCalledWith(
      2,
      userId,
      suspendedOrganizationId,
    );
  });

  it('lists every organization for the environment Super Admin', async () => {
    const otherOrganizationId = 'a31fcdfd-9612-450d-bf18-4b4160ba4cc1';
    isConfiguredSuperAdminUserId.mockResolvedValue(true);
    organizationFindMany.mockResolvedValue([
      {
        id: organizationId,
        name: 'Example Organization',
        slug: 'example-organization',
      },
      {
        id: otherOrganizationId,
        name: 'Other Organization',
        slug: 'other-organization',
      },
    ]);
    resolveOrganizationAccess
      .mockResolvedValueOnce({
        userId,
        organizationId,
        membershipId: null,
        roles: [],
        permissions: ['users.manage'],
      })
      .mockResolvedValueOnce({
        userId,
        organizationId: otherOrganizationId,
        membershipId: null,
        roles: [
          {
            id: 'platform-role',
            name: 'Super Admin',
            scope: AccessScope.PLATFORM,
          },
        ],
        permissions: ['users.manage'],
      });

    await expect(service.getCurrentUserAccess(userId)).resolves.toMatchObject({
      hasGlobalOrganizationAccess: true,
      organizations: [
        {
          organization: { id: organizationId },
          membership: null,
          permissions: ['users.manage'],
        },
        {
          organization: { id: otherOrganizationId },
          membership: null,
          permissions: ['users.manage'],
        },
      ],
    });
    expect(organizationFindMany).toHaveBeenCalledWith({
      select: {
        id: true,
        name: true,
        slug: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      where: { status: OrganizationStatus.ACTIVE },
    });
  });

  it('allows selected organization access for an active member with no permissions', async () => {
    const access = {
      userId,
      organizationId,
      membershipId: 'membership-active',
      roles: [],
      permissions: [],
    };
    resolveOrganizationAccess.mockResolvedValue(access);

    await expect(
      service.getSelectedOrganizationAccess(userId, organizationId),
    ).resolves.toEqual({
      organization: {
        id: organizationId,
        name: 'Example Organization',
        slug: 'example-organization',
      },
      access,
    });
  });

  it('allows Super Admin selected organization access without a membership', async () => {
    const access = {
      userId,
      organizationId,
      membershipId: null,
      roles: [
        {
          id: 'platform-role',
          name: 'Platform Operator',
          scope: AccessScope.PLATFORM,
        },
      ],
      permissions: ['analytics.view'],
    };
    resolveOrganizationAccess.mockResolvedValue(access);

    await expect(
      service.getSelectedOrganizationAccess(userId, organizationId),
    ).resolves.toEqual(
      expect.objectContaining({
        access,
      }),
    );
  });

  it('does not reveal a missing or inaccessible organization', async () => {
    resolveOrganizationAccess.mockResolvedValue({
      userId,
      organizationId,
      membershipId: null,
      roles: [],
      permissions: [],
    });

    await expect(
      service.getSelectedOrganizationAccess(userId, organizationId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
