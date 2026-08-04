import { ConflictException } from '@nestjs/common';
import {
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
  const now = new Date('2026-08-03T12:00:00.000Z');
  const organizationRecord = {
    id: organizationId,
    name: 'Acme Finance',
    slug: 'acme-finance',
    createdByUserId: actorUserId,
    allowJoinRequests: true,
    createdAt: now,
    updatedAt: now,
    _count: {
      memberships: 0,
    },
  };
  const organizationFindMany = jest.fn();
  const organizationFindUnique = jest.fn();
  const organizationCreate = jest.fn();
  const organizationFindUniqueOrThrow = jest.fn();
  const organizationSubscriptionCreate = jest.fn();
  const organizationLimitCreate = jest.fn();
  const transaction = {
    organization: {
      create: organizationCreate,
      findUniqueOrThrow: organizationFindUniqueOrThrow,
    },
    organizationSubscription: {
      create: organizationSubscriptionCreate,
    },
    organizationLimit: {
      create: organizationLimitCreate,
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
  const invalidateOrganizationAccess = jest.fn();
  const accessControlService = {
    invalidateOrganizationAccess,
  } as unknown as AccessControlService;
  const service = new OrganizationsService(prisma, accessControlService);

  beforeEach(() => {
    jest.clearAllMocks();
    organizationFindMany.mockResolvedValue([organizationRecord]);
    organizationFindUnique.mockResolvedValue(null);
    organizationCreate.mockResolvedValue({ id: organizationId });
    organizationFindUniqueOrThrow.mockResolvedValue(organizationRecord);
    organizationSubscriptionCreate.mockResolvedValue({});
    organizationLimitCreate.mockResolvedValue({});
    invalidateOrganizationAccess.mockResolvedValue(undefined);
  });

  it('lists platform organization views', async () => {
    await expect(service.listOrganizations()).resolves.toEqual([
      {
        id: organizationId,
        name: 'Acme Finance',
        slug: 'acme-finance',
        createdByUserId: actorUserId,
        allowJoinRequests: true,
        createdAt: now,
        updatedAt: now,
        memberCount: 0,
      },
    ]);
    expect(organizationFindMany).toHaveBeenCalledWith({
      select: {
        id: true,
        name: true,
        slug: true,
        createdByUserId: true,
        allowJoinRequests: true,
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

  it('creates an organization without making the Super Admin a tenant member', async () => {
    await expect(
      service.createOrganization(actorUserId, { name: ' Acme   Finance ' }),
    ).resolves.toMatchObject({
      id: organizationId,
      name: 'Acme Finance',
      slug: 'acme-finance',
      memberCount: 0,
    });
    expect(organizationCreate).toHaveBeenCalledWith({
      data: {
        name: 'Acme Finance',
        slug: 'acme-finance',
        createdByUserId: actorUserId,
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
    expect(invalidateOrganizationAccess).toHaveBeenCalledWith(organizationId);
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

});
