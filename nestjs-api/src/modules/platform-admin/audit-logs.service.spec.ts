import { ForbiddenException } from '@nestjs/common';
import { AccessControlService } from '../access-control/access-control.service';
import { ORGANIZATION_PERMISSIONS } from '../access-control/rbac.constants';
import { EnvSuperAdminService } from '../auth/env-super-admin.service';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from './audit-logs.service';

describe('AuditLogsService', () => {
  const organizationId = '8225d0fe-6b18-475f-a56d-fdd5c6147edb';
  const otherOrganizationId = '3c84ea89-6b30-4d90-a444-c12ba29777fb';
  const principal: AuthenticatedPrincipal = {
    userId: '7ee81b20-3a9a-4303-b370-89abf77f1bfc',
    email: 'admin@example.com',
    isVerified: true,
    sessionId: 'session-1',
    tokenId: 'token-1',
  };
  const auditLogCount = jest.fn();
  const auditLogFindMany = jest.fn();
  const prisma = {
    auditLog: {
      count: auditLogCount,
      findMany: auditLogFindMany,
    },
  } as unknown as PrismaService;
  const resolveOrganizationAccess = jest.fn();
  const accessControlService = {
    resolveOrganizationAccess,
  } as unknown as AccessControlService;
  const isConfiguredSuperAdminUserId = jest.fn();
  const isConfiguredSuperAdminEmail = jest.fn();
  const getConfiguredEmail = jest.fn();
  const getDisplayName = jest.fn();
  const envSuperAdminService = {
    getConfiguredEmail,
    getDisplayName,
    isConfiguredEmail: isConfiguredSuperAdminEmail,
    isConfiguredUserId: isConfiguredSuperAdminUserId,
  } as unknown as EnvSuperAdminService;
  const service = new AuditLogsService(
    prisma,
    accessControlService,
    envSuperAdminService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    auditLogCount.mockResolvedValue(0);
    auditLogFindMany.mockResolvedValue([]);
    getConfiguredEmail.mockReturnValue('super@example.com');
    getDisplayName.mockReturnValue('Whimsyworld');
    isConfiguredSuperAdminEmail.mockReturnValue(false);
    isConfiguredSuperAdminUserId.mockResolvedValue(false);
    resolveOrganizationAccess.mockResolvedValue({
      userId: principal.userId,
      organizationId,
      membershipId: 'membership-1',
      roles: [],
      permissions: [ORGANIZATION_PERMISSIONS.membersManage],
    });
  });

  it('forces organization admins to query only an organization they can manage', async () => {
    await service.listAuditLogs({ organizationId }, principal);

    expect(resolveOrganizationAccess).toHaveBeenCalledWith(
      principal.userId,
      organizationId,
    );
    expect(auditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId,
          NOT: {
            OR: [
              { actor: { is: { email: 'super@example.com' } } },
              { actorEmail: 'super@example.com' },
              {
                metadata: {
                  path: ['actor', 'email'],
                  equals: 'super@example.com',
                },
              },
            ],
          },
        }),
      }),
    );
  });

  it('rejects organization admins querying another organization without access', async () => {
    resolveOrganizationAccess.mockResolvedValue(null);

    await expect(
      service.listAuditLogs({ organizationId: otherOrganizationId }, principal),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(auditLogFindMany).not.toHaveBeenCalled();
  });

  it('lets Super Admin query platform-wide audit logs', async () => {
    isConfiguredSuperAdminUserId.mockResolvedValue(true);

    await service.listAuditLogs({}, principal);

    expect(resolveOrganizationAccess).not.toHaveBeenCalled();
    expect(auditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
      }),
    );
  });

  it('returns actor name and email from audit snapshots when the user relation is gone', async () => {
    const log = {
      id: 'audit-log-1',
      actorUserId: 'a2f0b4fe-0204-40c3-9a31-21f81c50fd4c',
      actorName: 'Ahmed Khan',
      actorEmail: 'ahmed@example.com',
      organizationId,
      action: 'PATCH /api/organizations/member',
      method: 'PATCH',
      path: '/api/organizations/member',
      resource: 'organization.members',
      statusCode: 200,
      ipAddress: '127.0.0.1',
      userAgent: 'Jest',
      metadata: null,
      createdAt: new Date('2026-08-05T08:30:00.000Z'),
      actor: null,
      organization: {
        id: organizationId,
        name: 'Acme Finance',
        slug: 'acme-finance',
      },
    };
    auditLogCount.mockResolvedValue(1);
    auditLogFindMany.mockResolvedValue([log]);

    const result = await service.listAuditLogs({ organizationId }, principal);

    expect(result.logs[0].actor).toEqual({
      id: log.actorUserId,
      email: 'ahmed@example.com',
      name: 'Ahmed Khan',
    });
  });

  it('exports filtered audit logs as readable text', async () => {
    const log = {
      id: 'audit-log-2',
      actorUserId: 'a2f0b4fe-0204-40c3-9a31-21f81c50fd4c',
      actorName: 'Ahmed Khan',
      actorEmail: 'ahmed@example.com',
      organizationId,
      action: 'PATCH /api/organizations/member',
      method: 'PATCH',
      path: '/api/organizations/member',
      resource: 'organization.members',
      statusCode: 200,
      ipAddress: '127.0.0.1',
      userAgent: 'Jest',
      metadata: {
        reason: 'Role updated',
        oldRole: 'Employee',
        newRole: 'Manager',
      },
      createdAt: new Date('2026-08-05T08:30:00.000Z'),
      actor: null,
      organization: {
        id: organizationId,
        name: 'Acme Finance',
        slug: 'acme-finance',
      },
    };
    auditLogFindMany.mockResolvedValue([log]);

    const result = await service.exportAuditLogs({ organizationId }, principal);

    expect(result.filename).toMatch(/^audit-logs-organization-/);
    expect(result.count).toBe(1);
    expect(result.truncated).toBe(false);
    expect(result.content).toContain('DOCUMIND Audit Logs');
    expect(result.content).toContain('Ahmed Khan <ahmed@example.com>');
    expect(result.content).toContain('PATCH /api/organizations/member');
    expect(result.content).toContain('Role changed from Employee to Manager.');
    expect(auditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5001,
      }),
    );
  });
});
