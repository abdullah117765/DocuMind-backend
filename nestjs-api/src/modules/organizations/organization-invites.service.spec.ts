import { HttpException } from '@nestjs/common';
import {
  AccessScope,
  OrganizationInviteStatus,
} from '../../generated/prisma/client';
import { AccessControlService } from '../access-control/access-control.service';
import { EnvSuperAdminService } from '../auth/env-super-admin.service';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrganizationInvitesService } from './organization-invites.service';

interface OrganizationInviteUpdateManyArgs {
  data?: Record<string, unknown>;
  where: Record<string, unknown>;
}

describe('OrganizationInvitesService', () => {
  const organizationId = '3c84ea89-6b30-4d90-a444-c12ba29777fb';
  const actorUserId = '7ee81b20-3a9a-4303-b370-89abf77f1bfc';
  const inviteId = '58e00226-8217-40cc-aa59-f8e688cdcc52';
  const roleId = 'b91886ad-8bc0-4f3f-b8b2-31c196f1fe50';
  const now = new Date('2026-08-04T09:00:00.000Z');
  const actor: AuthenticatedPrincipal = {
    email: 'admin@example.com',
    isVerified: true,
    sessionId: 'session-1',
    tokenId: 'token-1',
    userId: actorUserId,
  };
  const role = {
    id: roleId,
    organizationId: null,
    systemKey: 'viewer',
    name: 'Viewer',
    isSystem: true,
    permissions: [],
  };
  const inviteRecord = {
    id: inviteId,
    organizationId,
    invitedName: 'Member User',
    email: 'member@example.com',
    status: OrganizationInviteStatus.PENDING,
    expiresAt: new Date('2026-08-11T09:00:00.000Z'),
    acceptedAt: null,
    revokedAt: null,
    lastSentAt: null,
    lastSendFailureAt: null,
    lastSendFailureReason: null,
    createdAt: now,
    updatedAt: now,
    invitedByUserId: actorUserId,
    organization: {
      id: organizationId,
      name: 'Acme Finance',
      slug: 'acme-finance',
    },
    roles: [{ role }],
  };
  const roleFindMany = jest.fn();
  const platformUserRoleFindFirst = jest.fn();
  const userFindUnique = jest.fn();
  const organizationLimitFindUnique = jest.fn();
  const organizationMembershipCount = jest.fn();
  const organizationInviteCount = jest.fn();
  const organizationInviteUpdate = jest.fn();
  const organizationInviteUpdateMany = jest.fn() as jest.Mock<
    Promise<{ count: number }>,
    [OrganizationInviteUpdateManyArgs]
  >;
  const transactionOrganizationFindUnique = jest.fn();
  const transactionInviteCreate = jest.fn();
  const transactionInviteFindUniqueOrThrow = jest.fn();
  const transactionInviteRoleCreateMany = jest.fn();
  const transactionClient = {
    organization: {
      findUnique: transactionOrganizationFindUnique,
    },
    organizationInvite: {
      create: transactionInviteCreate,
      findUniqueOrThrow: transactionInviteFindUniqueOrThrow,
    },
    organizationInviteRole: {
      createMany: transactionInviteRoleCreateMany,
    },
  };
  const runTransaction = jest.fn(
    async (callback: (client: typeof transactionClient) => Promise<unknown>) =>
      callback(transactionClient),
  );
  const prisma = {
    role: {
      findMany: roleFindMany,
    },
    user: {
      findUnique: userFindUnique,
    },
    platformUserRole: {
      findFirst: platformUserRoleFindFirst,
    },
    organizationLimit: {
      findUnique: organizationLimitFindUnique,
    },
    organizationMembership: {
      count: organizationMembershipCount,
    },
    organizationInvite: {
      count: organizationInviteCount,
      update: organizationInviteUpdate,
      updateMany: organizationInviteUpdateMany,
    },
    $transaction: runTransaction,
  } as unknown as PrismaService;
  const sendOrganizationInvite = jest.fn();
  const mailService = {
    sendOrganizationInvite,
  } as unknown as MailService;
  const invalidateUserAccess = jest.fn();
  const isConfiguredSuperAdminEmail = jest.fn();
  const isConfiguredSuperAdminUserId = jest.fn();
  const accessControlService = {
    invalidateUserAccess,
  } as unknown as AccessControlService;
  const envSuperAdminService = {
    isConfiguredEmail: isConfiguredSuperAdminEmail,
    isConfiguredUserId: isConfiguredSuperAdminUserId,
  } as unknown as EnvSuperAdminService;
  const service = new OrganizationInvitesService(
    prisma,
    mailService,
    accessControlService,
    envSuperAdminService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    roleFindMany.mockResolvedValue([role]);
    platformUserRoleFindFirst.mockResolvedValue(null);
    userFindUnique.mockResolvedValue(null);
    organizationLimitFindUnique.mockResolvedValue({ maxMembers: 10 });
    organizationMembershipCount.mockResolvedValue(1);
    organizationInviteCount.mockResolvedValue(0);
    transactionOrganizationFindUnique.mockResolvedValue({
      id: organizationId,
      name: 'Acme Finance',
      slug: 'acme-finance',
    });
    transactionInviteCreate.mockResolvedValue({ id: inviteId });
    transactionInviteFindUniqueOrThrow.mockResolvedValue(inviteRecord);
    transactionInviteRoleCreateMany.mockResolvedValue({ count: 1 });
    organizationInviteUpdate.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...inviteRecord,
        ...data,
      }),
    );
    organizationInviteUpdateMany.mockResolvedValue({ count: 1 });
    sendOrganizationInvite.mockResolvedValue(undefined);
    invalidateUserAccess.mockResolvedValue(undefined);
    isConfiguredSuperAdminEmail.mockReturnValue(false);
    isConfiguredSuperAdminUserId.mockResolvedValue(false);
  });

  it('creates an invite, assigns initial roles, and sends the email', async () => {
    await expect(
      service.inviteMember(
        organizationId,
        actor,
        {
          name: 'Member User',
          email: ' MEMBER@example.com ',
          roleIds: [roleId],
        },
        now,
      ),
    ).resolves.toMatchObject({
      id: inviteId,
      email: 'member@example.com',
      roles: [role],
      status: OrganizationInviteStatus.PENDING,
    });

    expect(roleFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: [roleId] },
        scope: AccessScope.ORGANIZATION,
        isActive: true,
        OR: [{ organizationId: null }, { organizationId }],
      },
      select: {
        id: true,
        organizationId: true,
        systemKey: true,
        name: true,
        isSystem: true,
        permissions: {
          select: {
            permission: {
              select: {
                code: true,
              },
            },
          },
        },
      },
    });
    expect(sendOrganizationInvite).toHaveBeenCalledWith(
      'member@example.com',
      'Acme Finance',
      expect.any(String),
      7,
      {
        invitedName: 'Member User',
        roleNames: ['Viewer'],
        temporaryPassword: expect.any(String),
        temporaryPasswordExpiresInHours: 24,
      },
    );
    expect(
      transactionInviteCreate.mock.calls[0]?.[0].data.temporaryPasswordHash,
    ).toEqual(expect.stringMatching(/^\$2[aby]\$/));
    expect(
      transactionInviteCreate.mock.calls[0]?.[0].data
        .temporaryPasswordExpiresAt,
    ).toBeInstanceOf(Date);
    const supersedingInviteCleanup =
      organizationInviteUpdateMany.mock.calls[0]?.[0];

    if (!supersedingInviteCleanup) {
      throw new Error('Expected stale pending invites to be revoked');
    }

    expect(supersedingInviteCleanup.where).toMatchObject({
      email: 'member@example.com',
      id: { not: inviteId },
      organizationId,
      status: OrganizationInviteStatus.PENDING,
    });
  });

  it('revokes a prepared invite and returns a setup-facing error when email delivery fails', async () => {
    sendOrganizationInvite.mockRejectedValue(new Error('SMTP unavailable'));

    try {
      await service.inviteMember(
        organizationId,
        actor,
        {
          name: 'Member User',
          email: 'member@example.com',
          roleIds: [roleId],
        },
        now,
      );
      throw new Error('Expected invite delivery to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(424);
      expect((error as HttpException).getResponse()).toEqual({
        message:
          'Invitation was created, but the email could not be delivered. Check SMTP settings, then resend or revoke the invite.',
        details: { reason: 'INVITE_EMAIL_DELIVERY_FAILED' },
      });
    }
    const failedInviteCleanup = organizationInviteUpdateMany.mock.calls[0]?.[0];

    if (!failedInviteCleanup?.data) {
      throw new Error('Expected failed invite to be marked with delivery data');
    }

    expect(failedInviteCleanup.where).toEqual({
      id: inviteId,
      status: OrganizationInviteStatus.PENDING,
    });
    expect(failedInviteCleanup.data.status).toBeUndefined();
    expect(failedInviteCleanup.data.revokedAt).toBeUndefined();
    expect(failedInviteCleanup.data.lastSendFailureAt).toBeInstanceOf(Date);
    expect(failedInviteCleanup.data.lastSendFailureReason).toBe(
      'SMTP unavailable',
    );
  });

  it('revokes a pending invitation by organization and invite id', async () => {
    organizationInviteUpdateMany.mockResolvedValue({ count: 1 });

    await service.revokeInvite(organizationId, inviteId);

    const revokeCall = organizationInviteUpdateMany.mock.calls[0]?.[0];

    if (!revokeCall?.data) {
      throw new Error('Expected pending invite to be revoked');
    }

    expect(revokeCall.where).toEqual({
      id: inviteId,
      organizationId,
      status: OrganizationInviteStatus.PENDING,
    });
    expect(revokeCall.data.status).toBe(OrganizationInviteStatus.REVOKED);
    expect(revokeCall.data.revokedAt).toBeInstanceOf(Date);
  });
});
