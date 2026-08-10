import { ConflictException } from '@nestjs/common';
import {
  OrganizationMembershipStatus,
  OrganizationStatus,
  Prisma,
} from '../../generated/prisma/client';
import { AccessControlService } from '../access-control/access-control.service';
import { RagOrchestratorService } from '../documents/rag-orchestrator.service';
import { PrismaService } from '../prisma/prisma.service';
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
    status: OrganizationStatus.ACTIVE,
    allowJoinRequests: true,
    createdAt: now,
    updatedAt: now,
    _count: {
      memberships: 0,
    },
  };
  const organizationFindMany = jest.fn();
  const organizationCount = jest.fn();
  const organizationFindUnique = jest.fn();
  const organizationCreate = jest.fn();
  const organizationUpdate = jest.fn();
  const organizationDelete = jest.fn();
  const organizationFindUniqueOrThrow = jest.fn();
  const transaction = {
    organization: {
      create: organizationCreate,
      findUniqueOrThrow: organizationFindUniqueOrThrow,
    },
  };
  const runTransaction = jest.fn(
    async (callback: (client: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
  );
  const prisma = {
    organization: {
      count: organizationCount,
      findMany: organizationFindMany,
      findUnique: organizationFindUnique,
      update: organizationUpdate,
      delete: organizationDelete,
    },
    $transaction: runTransaction,
  } as unknown as PrismaService;
  const invalidateOrganizationAccess = jest.fn();
  const accessControlService = {
    invalidateOrganizationAccess,
  } as unknown as AccessControlService;
  const deleteOrganizationVectors = jest.fn();
  const ragOrchestrator = {
    deleteOrganization: deleteOrganizationVectors,
  } as unknown as RagOrchestratorService;
  const service = new OrganizationsService(
    prisma,
    accessControlService,
    ragOrchestrator,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    organizationCount.mockResolvedValue(1);
    organizationFindMany.mockResolvedValue([organizationRecord]);
    organizationFindUnique.mockResolvedValue(null);
    organizationCreate.mockResolvedValue({ id: organizationId });
    organizationUpdate.mockResolvedValue(organizationRecord);
    organizationDelete.mockResolvedValue(organizationRecord);
    organizationFindUniqueOrThrow.mockResolvedValue(organizationRecord);
    invalidateOrganizationAccess.mockResolvedValue(undefined);
    deleteOrganizationVectors.mockResolvedValue(undefined);
  });

  it('lists platform organization views', async () => {
    await expect(service.listOrganizations()).resolves.toEqual({
      organizations: [
        {
          id: organizationId,
          name: 'Acme Finance',
          slug: 'acme-finance',
          createdByUserId: actorUserId,
          status: OrganizationStatus.ACTIVE,
          allowJoinRequests: true,
          createdAt: now,
          updatedAt: now,
          memberCount: 0,
        },
      ],
      pagination: {
        page: 1,
        pageCount: 1,
        pageSize: 20,
        total: 1,
      },
    });
    expect(organizationCount).toHaveBeenCalledWith({ where: {} });
    expect(organizationFindMany).toHaveBeenCalledWith({
      where: {},
      select: {
        id: true,
        name: true,
        slug: true,
        createdByUserId: true,
        status: true,
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
      skip: 0,
      take: 20,
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
        allowJoinRequests: true,
      },
      select: { id: true },
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
        allowJoinRequests: true,
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

  it('deletes an organization and cleans up its RAG vectors', async () => {
    await expect(
      service.deleteOrganization(organizationId),
    ).resolves.toBeUndefined();

    expect(organizationDelete).toHaveBeenCalledWith({
      where: { id: organizationId },
    });
    expect(invalidateOrganizationAccess).toHaveBeenCalledWith(organizationId);
    expect(deleteOrganizationVectors).toHaveBeenCalledWith(organizationId);
  });
});
