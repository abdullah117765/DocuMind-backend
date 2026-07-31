import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessScope,
  OrganizationMembershipStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccessControlService } from './access-control.service';
import { OrganizationMembersService } from './organization-members.service';

describe('OrganizationMembersService', () => {
  const organizationId = '3c84ea89-6b30-4d90-a444-c12ba29777fb';
  const membershipId = '58e00226-8217-40cc-aa59-f8e688cdcc52';
  const actorUserId = '7ee81b20-3a9a-4303-b370-89abf77f1bfc';
  const memberUserId = '80d540ef-ed7b-41fd-a136-93b37cae8d39';
  const adminRole = {
    id: 'b429b596-1865-4ace-bd6d-9ca3b52da710',
    organizationId: null,
    name: 'Organization Admin',
    isSystem: true,
    permissions: [
      {
        permission: {
          code: 'users.manage',
        },
      },
    ],
  };
  const viewerRole = {
    id: 'e49feaf4-2d74-4d94-ae9b-1ac8a35be9ea',
    organizationId: null,
    name: 'Viewer',
    isSystem: true,
    permissions: [],
  };
  const membership = {
    id: membershipId,
    organizationId,
    userId: memberUserId,
    status: OrganizationMembershipStatus.ACTIVE,
    createdAt: new Date('2026-07-31T00:00:00.000Z'),
    updatedAt: new Date('2026-07-31T00:00:00.000Z'),
    user: {
      id: memberUserId,
      email: 'member@example.com',
      isVerified: true,
    },
    roles: [{ role: adminRole }],
  };
  const userFindFirst = jest.fn();
  const membershipFindMany = jest.fn();
  const membershipFindFirst = jest.fn();
  const membershipFindUnique = jest.fn();
  const membershipCreate = jest.fn();
  const membershipUpdate = jest.fn();
  const roleFindMany = jest.fn();
  const membershipRoleCreateMany = jest.fn();
  const membershipRoleDeleteMany = jest.fn();
  const transactionMembershipFindFirst = jest.fn();
  const transactionClient = {
    organizationMembership: {
      create: membershipCreate,
      findFirst: transactionMembershipFindFirst,
      update: membershipUpdate,
    },
    membershipRole: {
      createMany: membershipRoleCreateMany,
      deleteMany: membershipRoleDeleteMany,
    },
  };
  const runTransaction = jest.fn();
  const prisma = {
    user: {
      findFirst: userFindFirst,
    },
    organizationMembership: {
      findMany: membershipFindMany,
      findFirst: membershipFindFirst,
      findUnique: membershipFindUnique,
      update: membershipUpdate,
    },
    role: {
      findMany: roleFindMany,
    },
    $transaction: runTransaction,
  } as unknown as PrismaService;
  const invalidateUserAccess = jest.fn();
  const accessControlService = {
    invalidateUserAccess,
  } as unknown as AccessControlService;
  const service = new OrganizationMembersService(prisma, accessControlService);

  beforeEach(() => {
    jest.clearAllMocks();
    runTransaction.mockImplementation(
      (callback: (transaction: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient),
    );
    userFindFirst.mockResolvedValue({ id: memberUserId });
    membershipFindMany.mockResolvedValue([]);
    membershipFindUnique.mockResolvedValue(null);
    membershipCreate.mockResolvedValue({ id: membershipId });
    membershipUpdate.mockResolvedValue({ id: membershipId });
    roleFindMany.mockResolvedValue([]);
    membershipRoleCreateMany.mockResolvedValue({ count: 1 });
    membershipRoleDeleteMany.mockResolvedValue({ count: 1 });
    transactionMembershipFindFirst.mockResolvedValue(null);
    invalidateUserAccess.mockResolvedValue();
  });

  it('lists active and suspended members as API views', async () => {
    membershipFindMany.mockResolvedValue([
      membership,
      {
        ...membership,
        id: 'f551a32e-ac9d-4dc0-b963-56c917425911',
        status: OrganizationMembershipStatus.SUSPENDED,
        roles: [{ role: viewerRole }],
      },
    ]);

    const result = await service.listMembers(organizationId);

    expect(result).toEqual([
      expect.objectContaining({
        id: membershipId,
        status: OrganizationMembershipStatus.ACTIVE,
        roles: [
          {
            id: adminRole.id,
            organizationId: null,
            name: adminRole.name,
            isSystem: true,
          },
        ],
      }),
      expect.objectContaining({
        status: OrganizationMembershipStatus.SUSPENDED,
      }),
    ]);
  });

  it('does not expose removed or cross-organization memberships', async () => {
    membershipFindFirst.mockResolvedValue(null);

    await expect(
      service.getMember(organizationId, membershipId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires an existing verified user when adding a member', async () => {
    userFindFirst.mockResolvedValue(null);

    await expect(
      service.addMember(organizationId, actorUserId, {
        email: 'missing@example.com',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(membershipCreate).not.toHaveBeenCalled();
  });

  it('rejects invalid, inactive, platform, or foreign role IDs', async () => {
    roleFindMany.mockResolvedValue([]);

    await expect(
      service.addMember(organizationId, actorUserId, {
        email: 'member@example.com',
        roleIds: [viewerRole.id],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(membershipCreate).not.toHaveBeenCalled();
  });

  it('rejects a user who is already active or suspended', async () => {
    membershipFindUnique.mockResolvedValue({
      id: membershipId,
      status: OrganizationMembershipStatus.ACTIVE,
    });

    await expect(
      service.addMember(organizationId, actorUserId, {
        email: 'member@example.com',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a membership with initial roles and invalidates user access', async () => {
    roleFindMany.mockResolvedValue([viewerRole]);
    membershipFindFirst.mockResolvedValue({
      ...membership,
      roles: [{ role: viewerRole }],
    });

    await expect(
      service.addMember(organizationId, actorUserId, {
        email: ' MEMBER@example.com ',
        roleIds: [viewerRole.id],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: membershipId,
        roles: [
          expect.objectContaining({
            id: viewerRole.id,
          }),
        ],
      }),
    );
    expect(userFindFirst).toHaveBeenCalledWith({
      where: {
        email: 'member@example.com',
        isVerified: true,
      },
      select: { id: true },
    });
    expect(membershipCreate).toHaveBeenCalledWith({
      data: {
        organizationId,
        userId: memberUserId,
        status: OrganizationMembershipStatus.ACTIVE,
      },
      select: { id: true },
    });
    expect(membershipRoleCreateMany).toHaveBeenCalledWith({
      data: [
        {
          membershipId,
          roleId: viewerRole.id,
          assignedByUserId: actorUserId,
        },
      ],
    });
    expect(invalidateUserAccess).toHaveBeenCalledWith(memberUserId);
  });

  it('safely restores a removed membership after clearing stale roles', async () => {
    membershipFindUnique.mockResolvedValue({
      id: membershipId,
      status: OrganizationMembershipStatus.REMOVED,
    });
    membershipFindFirst.mockResolvedValue({
      ...membership,
      roles: [],
    });

    await service.addMember(organizationId, actorUserId, {
      email: 'member@example.com',
    });

    expect(membershipUpdate).toHaveBeenCalledWith({
      where: { id: membershipId },
      data: {
        status: OrganizationMembershipStatus.ACTIVE,
      },
      select: { id: true },
    });
    expect(membershipRoleDeleteMany).toHaveBeenCalledWith({
      where: { membershipId },
    });
  });

  it('prevents removing the final active user manager role', async () => {
    membershipFindFirst.mockResolvedValueOnce(membership);
    transactionMembershipFindFirst.mockResolvedValue(null);
    roleFindMany.mockResolvedValue([viewerRole]);

    await expect(
      service.replaceMemberRoles(organizationId, membershipId, actorUserId, [
        viewerRole.id,
      ]),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(membershipRoleDeleteMany).not.toHaveBeenCalled();
  });

  it('atomically replaces roles when another user manager remains', async () => {
    const updatedMembership = {
      ...membership,
      roles: [{ role: viewerRole }],
    };
    membershipFindFirst
      .mockResolvedValueOnce(membership)
      .mockResolvedValueOnce(updatedMembership);
    transactionMembershipFindFirst.mockResolvedValue({
      id: 'another-manager',
    });
    roleFindMany.mockResolvedValue([viewerRole]);

    await service.replaceMemberRoles(
      organizationId,
      membershipId,
      actorUserId,
      [viewerRole.id],
    );

    expect(membershipRoleDeleteMany).toHaveBeenCalledWith({
      where: { membershipId },
    });
    expect(membershipRoleCreateMany).toHaveBeenCalledWith({
      data: [
        {
          membershipId,
          roleId: viewerRole.id,
          assignedByUserId: actorUserId,
        },
      ],
    });
    expect(invalidateUserAccess).toHaveBeenCalledWith(memberUserId);
  });

  it('prevents suspending the final active user manager', async () => {
    membershipFindFirst.mockResolvedValueOnce(membership);
    transactionMembershipFindFirst.mockResolvedValue(null);

    await expect(
      service.updateMemberStatus(
        organizationId,
        membershipId,
        OrganizationMembershipStatus.SUSPENDED,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(membershipUpdate).not.toHaveBeenCalled();
  });

  it('reactivates a suspended member and restores their assigned access', async () => {
    const suspendedMembership = {
      ...membership,
      status: OrganizationMembershipStatus.SUSPENDED,
    };
    membershipFindFirst
      .mockResolvedValueOnce(suspendedMembership)
      .mockResolvedValueOnce(membership);

    await service.updateMemberStatus(
      organizationId,
      membershipId,
      OrganizationMembershipStatus.ACTIVE,
    );

    expect(membershipUpdate).toHaveBeenCalledWith({
      where: { id: membershipId },
      data: {
        status: OrganizationMembershipStatus.ACTIVE,
      },
    });
    expect(invalidateUserAccess).toHaveBeenCalledWith(memberUserId);
  });

  it('removes a member and revokes every assigned role', async () => {
    membershipFindFirst.mockResolvedValue({
      ...membership,
      roles: [{ role: viewerRole }],
    });

    await service.removeMember(organizationId, membershipId);

    expect(membershipRoleDeleteMany).toHaveBeenCalledWith({
      where: { membershipId },
    });
    expect(membershipUpdate).toHaveBeenCalledWith({
      where: { id: membershipId },
      data: {
        status: OrganizationMembershipStatus.REMOVED,
      },
    });
    expect(invalidateUserAccess).toHaveBeenCalledWith(memberUserId);
  });

  it('queries only active organization-scoped applicable roles', async () => {
    roleFindMany.mockResolvedValue([viewerRole]);
    membershipFindFirst
      .mockResolvedValueOnce({
        ...membership,
        roles: [{ role: viewerRole }],
      })
      .mockResolvedValueOnce({
        ...membership,
        roles: [{ role: viewerRole }],
      });

    await service.replaceMemberRoles(
      organizationId,
      membershipId,
      actorUserId,
      [viewerRole.id],
    );

    expect(roleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: [viewerRole.id] },
          scope: AccessScope.ORGANIZATION,
          isActive: true,
          OR: [{ organizationId: null }, { organizationId }],
        },
      }),
    );
  });
});
