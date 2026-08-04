import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  AccessScope,
  OrganizationMembershipStatus,
  Prisma,
  SubscriptionStatus,
} from '../../generated/prisma/client';
import { AccessControlService } from '../access-control/access-control.service';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_ORGANIZATION_LIMITS } from './organization-defaults';
import { OrganizationsService } from './organizations.service';

describe('OrganizationsService', () => {
  const actorUserId = '7ee81b20-3a9a-4303-b370-89abf77f1bfc';
  const organizationId = '3c84ea89-6b30-4d90-a444-c12ba29777fb';
  const membershipId = '58e00226-8217-40cc-aa59-f8e688cdcc52';
  const roleId = 'b91886ad-8bc0-4f3f-b8b2-31c196f1fe50';
  const now = new Date('2026-08-03T12:00:00.000Z');
  const organizationRecord = {
    id: organizationId,
    name: 'Acme Finance',
    slug: 'acme-finance',
    createdByUserId: actorUserId,
    createdAt: now,
    updatedAt: now,
    _count: {
      memberships: 1,
    },
  };
  const organizationFindMany = jest.fn();
  const organizationFindUnique = jest.fn();
  const organizationCreate = jest.fn();
  const organizationFindUniqueOrThrow = jest.fn();
  const organizationMembershipCreate = jest.fn();
  const organizationSubscriptionCreate = jest.fn();
  const organizationLimitCreate = jest.fn();
  const membershipRoleCreate = jest.fn();
  const roleFindFirst = jest.fn();
  const transaction = {
    organization: {
      create: organizationCreate,
      findUniqueOrThrow: organizationFindUniqueOrThrow,
    },
    organizationMembership: {
      create: organizationMembershipCreate,
    },
    organizationSubscription: {
      create: organizationSubscriptionCreate,
    },
    organizationLimit: {
      create: organizationLimitCreate,
    },
    membershipRole: {
      create: membershipRoleCreate,
    },
    role: {
      findFirst: roleFindFirst,
    },
  };
  const runTransaction = jest.fn(
    async (callback: (client: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  );
  const prisma = {
    organization: {
      findMany: organizationFindMany,
      findUnique: organizationFindUnique,
    },
    $transaction: runTransaction,
  } as unknown as PrismaService;
  const invalidateUserAccess = jest.fn();
  const accessControlService = {
    invalidateUserAccess,
  } as unknown as AccessControlService;
  const service = new OrganizationsService(prisma, accessControlService);

  beforeEach(() => {
    jest.clearAllMocks();
    organizationFindMany.mockResolvedValue([organizationRecord]);
    organizationFindUnique.mockResolvedValue(null);
    organizationCreate.mockResolvedValue({ id: organizationId });
    organizationFindUniqueOrThrow.mockResolvedValue(organizationRecord);
    organizationMembershipCreate.mockResolvedValue({ id: membershipId });
    organizationSubscriptionCreate.mockResolvedValue({});
    organizationLimitCreate.mockResolvedValue({});
    membershipRoleCreate.mockResolvedValue({ membershipId, roleId });
    roleFindFirst.mockResolvedValue({ id: roleId });
    invalidateUserAccess.mockResolvedValue(undefined);
  });

  it('lists platform organization views', async () => {
    await expect(service.listOrganizations()).resolves.toEqual([
      {
        id: organizationId,
        name: 'Acme Finance',
        slug: 'acme-finance',
        createdByUserId: actorUserId,
        createdAt: now,
        updatedAt: now,
        memberCount: 1,
      },
    ]);
    expect(organizationFindMany).toHaveBeenCalledWith({
      select: {
        id: true,
        name: true,
        slug: true,
        createdByUserId: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            memberships: {
              where: {
                status: {
                  not: OrganizationMembershipStatus.REMOVED,
                },
              },
            },
          },
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  });

  it('creates an organization and makes the Super Admin an organization admin', async () => {
    await expect(
      service.createOrganization(actorUserId, { name: ' Acme   Finance ' }),
    ).resolves.toMatchObject({
      id: organizationId,
      name: 'Acme Finance',
      slug: 'acme-finance',
      memberCount: 1,
    });
    expect(roleFindFirst).toHaveBeenCalledWith({
      where: {
        systemKey: 'organization_admin',
        scope: AccessScope.ORGANIZATION,
        isActive: true,
      },
      select: { id: true },
    });
    expect(organizationCreate).toHaveBeenCalledWith({
      data: {
        name: 'Acme Finance',
        slug: 'acme-finance',
        createdByUserId: actorUserId,
      },
      select: { id: true },
    });
    expect(organizationMembershipCreate).toHaveBeenCalledWith({
      data: {
        organizationId,
        userId: actorUserId,
        status: OrganizationMembershipStatus.ACTIVE,
      },
      select: { id: true },
    });
    expect(organizationSubscriptionCreate).toHaveBeenCalledWith({
      data: {
        organizationId,
        plan: 'FREE',
        status: SubscriptionStatus.ACTIVE,
      },
    });
    expect(organizationLimitCreate).toHaveBeenCalledWith({
      data: {
        organizationId,
        ...DEFAULT_ORGANIZATION_LIMITS,
      },
    });
    expect(membershipRoleCreate).toHaveBeenCalledWith({
      data: {
        membershipId,
        roleId,
        assignedByUserId: actorUserId,
      },
    });
    expect(invalidateUserAccess).toHaveBeenCalledWith(actorUserId);
  });

  it('generates a unique slug when the name slug is already used', async () => {
    organizationFindUnique
      .mockResolvedValueOnce({ id: 'existing-organization' })
      .mockResolvedValueOnce(null);

    await service.createOrganization(actorUserId, { name: 'Acme Finance' });

    expect(organizationFindUnique).toHaveBeenNthCalledWith(1, {
      where: { slug: 'acme-finance' },
      select: { id: true },
    });
    expect(organizationFindUnique).toHaveBeenNthCalledWith(2, {
      where: { slug: 'acme-finance-2' },
      select: { id: true },
    });
    expect(organizationCreate).toHaveBeenCalledWith({
      data: {
        name: 'Acme Finance',
        slug: 'acme-finance-2',
        createdByUserId: actorUserId,
      },
      select: { id: true },
    });
  });

  it('rejects an explicit slug that races with another organization', async () => {
    runTransaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.createOrganization(actorUserId, {
        name: 'Acme Finance',
        slug: 'acme-finance',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('fails closed when the system organization admin role is missing', async () => {
    roleFindFirst.mockResolvedValue(null);

    await expect(
      service.createOrganization(actorUserId, { name: 'Acme Finance' }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(organizationCreate).not.toHaveBeenCalled();
  });
});
