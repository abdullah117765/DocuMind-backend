import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AccessScope } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccessControlService } from './access-control.service';
import { RoleManagementService } from './role-management.service';

describe('RoleManagementService', () => {
  const organizationId = '3c84ea89-6b30-4d90-a444-c12ba29777fb';
  const actorUserId = '7ee81b20-3a9a-4303-b370-89abf77f1bfc';
  const roleId = 'b429b596-1865-4ace-bd6d-9ca3b52da710';
  const permission = {
    id: '82570701-e4e6-470a-a896-37583a106ab8',
    code: 'documents.read',
    name: 'Read',
    description: 'View documents.',
    category: 'Documents',
    scope: AccessScope.ORGANIZATION,
  };
  const customRole = {
    id: roleId,
    organizationId,
    name: 'Reviewer',
    description: 'Reviews documents.',
    scope: AccessScope.ORGANIZATION,
    isSystem: false,
    isActive: true,
    createdAt: new Date('2026-07-31T00:00:00.000Z'),
    updatedAt: new Date('2026-07-31T00:00:00.000Z'),
    permissions: [{ permission }],
    _count: {
      membershipAssignments: 2,
    },
  };
  const userManagementPermission = {
    ...permission,
    id: 'fe78221c-c9a8-4536-aa54-a23a775ff130',
    code: 'users.manage',
    name: 'User Management',
    category: 'Administration',
  };
  const customUserManagerRole = {
    ...customRole,
    name: 'Custom User Manager',
    permissions: [{ permission: userManagementPermission }],
  };
  const systemRole = {
    ...customRole,
    id: 'e49feaf4-2d74-4d94-ae9b-1ac8a35be9ea',
    organizationId: null,
    name: 'Organization Admin',
    isSystem: true,
  };
  const permissionFindMany = jest.fn();
  const roleFindFirst = jest.fn();
  const roleFindMany = jest.fn();
  const roleCreate = jest.fn();
  const roleUpdate = jest.fn();
  const rolePermissionCreateMany = jest.fn();
  const rolePermissionDeleteMany = jest.fn();
  const membershipRoleDeleteMany = jest.fn();
  const transactionMembershipFindFirst = jest.fn();
  const transactionClient = {
    role: {
      create: roleCreate,
      update: roleUpdate,
    },
    rolePermission: {
      createMany: rolePermissionCreateMany,
      deleteMany: rolePermissionDeleteMany,
    },
    membershipRole: {
      deleteMany: membershipRoleDeleteMany,
    },
    organizationMembership: {
      findFirst: transactionMembershipFindFirst,
    },
  };
  const runTransaction = jest.fn();
  const prisma = {
    permission: {
      findMany: permissionFindMany,
    },
    role: {
      findFirst: roleFindFirst,
      findMany: roleFindMany,
      update: roleUpdate,
    },
    $transaction: runTransaction,
  } as unknown as PrismaService;
  const invalidateOrganizationAccess = jest.fn();
  const accessControlService = {
    invalidateOrganizationAccess,
  } as unknown as AccessControlService;
  const service = new RoleManagementService(prisma, accessControlService);

  beforeEach(() => {
    jest.clearAllMocks();
    runTransaction.mockImplementation(
      (callback: (transaction: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient),
    );
    permissionFindMany.mockResolvedValue([]);
    roleFindMany.mockResolvedValue([]);
    roleCreate.mockResolvedValue({ id: roleId });
    roleUpdate.mockResolvedValue(customRole);
    rolePermissionCreateMany.mockResolvedValue({ count: 1 });
    rolePermissionDeleteMany.mockResolvedValue({ count: 1 });
    membershipRoleDeleteMany.mockResolvedValue({ count: 1 });
    transactionMembershipFindFirst.mockResolvedValue(null);
    invalidateOrganizationAccess.mockResolvedValue();
  });

  it('lists the active organization permission catalog', async () => {
    permissionFindMany.mockResolvedValue([permission]);

    await expect(service.listPermissions()).resolves.toEqual([permission]);
    expect(permissionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          scope: AccessScope.ORGANIZATION,
          isActive: true,
        },
      }),
    );
  });

  it('lists applicable system and custom roles as API views', async () => {
    roleFindMany.mockResolvedValue([systemRole, customRole]);

    const result = await service.listRoles(organizationId);

    expect(result).toEqual([
      expect.objectContaining({
        id: systemRole.id,
        isSystem: true,
        assignedMembersCount: 2,
      }),
      expect.objectContaining({
        id: customRole.id,
        isSystem: false,
        permissions: [permission],
      }),
    ]);
  });

  it('returns not found for a role outside the organization context', async () => {
    roleFindFirst.mockResolvedValue(null);

    await expect(
      service.getRole(organizationId, roleId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates a custom role and its initial permission grants atomically', async () => {
    permissionFindMany.mockResolvedValue([
      { id: permission.id, code: permission.code },
    ]);
    roleFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(customRole);

    await expect(
      service.createRole(organizationId, actorUserId, {
        name: 'Reviewer',
        description: ' Reviews documents. ',
        permissionCodes: ['documents.read'],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: roleId,
        permissions: [permission],
      }),
    );
    expect(roleCreate).toHaveBeenCalledWith({
      data: {
        organizationId,
        name: 'Reviewer',
        normalizedName: 'reviewer',
        description: 'Reviews documents.',
        scope: AccessScope.ORGANIZATION,
        isSystem: false,
        isActive: true,
        autoGrantNewPermissions: false,
      },
      select: { id: true },
    });
    expect(rolePermissionCreateMany).toHaveBeenCalledWith({
      data: [
        {
          roleId,
          permissionId: permission.id,
          grantedByUserId: actorUserId,
        },
      ],
    });
    expect(invalidateOrganizationAccess).toHaveBeenCalledWith(organizationId);
  });

  it('rejects unknown, inactive, or wrong-scope permission codes', async () => {
    permissionFindMany.mockResolvedValue([]);

    await expect(
      service.createRole(organizationId, actorUserId, {
        name: 'Reviewer',
        permissionCodes: ['platform.unknown'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(roleCreate).not.toHaveBeenCalled();
  });

  it('prevents custom roles from shadowing an applicable system role name', async () => {
    roleFindFirst.mockResolvedValue(systemRole);

    await expect(
      service.createRole(organizationId, actorUserId, {
        name: ' Organization   Admin ',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('prevents updates to system roles', async () => {
    roleFindFirst.mockResolvedValue(systemRole);

    await expect(
      service.updateRole(organizationId, systemRole.id, {
        name: 'Changed',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(roleUpdate).not.toHaveBeenCalled();
  });

  it('requires at least one field when updating a custom role', async () => {
    roleFindFirst.mockResolvedValue(customRole);

    await expect(
      service.updateRole(organizationId, roleId, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates a custom role and invalidates its organization cache', async () => {
    const updatedRole = {
      ...customRole,
      name: 'Senior Reviewer',
    };
    roleFindFirst
      .mockResolvedValueOnce(customRole)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(updatedRole);

    await expect(
      service.updateRole(organizationId, roleId, {
        name: 'Senior Reviewer',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        name: 'Senior Reviewer',
      }),
    );
    expect(roleUpdate).toHaveBeenCalledWith({
      where: { id: roleId },
      data: {
        name: 'Senior Reviewer',
        normalizedName: 'senior reviewer',
      },
    });
    expect(invalidateOrganizationAccess).toHaveBeenCalledWith(organizationId);
  });

  it('atomically replaces every custom-role permission grant', async () => {
    permissionFindMany.mockResolvedValue([
      { id: permission.id, code: permission.code },
    ]);
    roleFindFirst
      .mockResolvedValueOnce(customRole)
      .mockResolvedValueOnce(customRole);

    await service.replaceRolePermissions(organizationId, roleId, actorUserId, [
      'documents.read',
    ]);

    expect(rolePermissionDeleteMany).toHaveBeenCalledWith({
      where: { roleId },
    });
    expect(rolePermissionCreateMany).toHaveBeenCalledWith({
      data: [
        {
          roleId,
          permissionId: permission.id,
          grantedByUserId: actorUserId,
        },
      ],
    });
    expect(invalidateOrganizationAccess).toHaveBeenCalledWith(organizationId);
  });

  it('allows clearing every permission from a custom role', async () => {
    roleFindFirst.mockResolvedValueOnce(customRole).mockResolvedValueOnce({
      ...customRole,
      permissions: [],
    });

    await service.replaceRolePermissions(
      organizationId,
      roleId,
      actorUserId,
      [],
    );

    expect(rolePermissionDeleteMany).toHaveBeenCalledWith({
      where: { roleId },
    });
    expect(rolePermissionCreateMany).not.toHaveBeenCalled();
  });

  it('prevents removing user management from a role when no alternative manager exists', async () => {
    roleFindFirst.mockResolvedValue(customUserManagerRole);
    transactionMembershipFindFirst
      .mockResolvedValueOnce({ id: 'affected-member' })
      .mockResolvedValueOnce(null);

    await expect(
      service.replaceRolePermissions(organizationId, roleId, actorUserId, []),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(rolePermissionDeleteMany).not.toHaveBeenCalled();
  });

  it('prevents deleting a user-management role when no alternative manager exists', async () => {
    roleFindFirst.mockResolvedValue(customUserManagerRole);
    transactionMembershipFindFirst
      .mockResolvedValueOnce({ id: 'affected-member' })
      .mockResolvedValueOnce(null);

    await expect(
      service.deleteRole(organizationId, roleId),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(membershipRoleDeleteMany).not.toHaveBeenCalled();
  });

  it('soft-deletes a custom role and revokes every member assignment', async () => {
    roleFindFirst.mockResolvedValue(customRole);

    await service.deleteRole(organizationId, roleId);

    expect(membershipRoleDeleteMany).toHaveBeenCalledWith({
      where: { roleId },
    });
    expect(roleUpdate).toHaveBeenCalledWith({
      where: { id: roleId },
      data: {
        isActive: false,
        normalizedName: `deleted:${roleId}`,
      },
    });
    expect(invalidateOrganizationAccess).toHaveBeenCalledWith(organizationId);
  });
});
