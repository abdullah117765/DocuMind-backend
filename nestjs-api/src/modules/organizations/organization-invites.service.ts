import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { compare, hash } from 'bcrypt';
import {
  AccessScope,
  OrganizationInviteStatus,
  OrganizationMembershipStatus,
  OrganizationStatus,
  Prisma,
} from '../../generated/prisma/client';
import { AccessControlService } from '../access-control/access-control.service';
import {
  ORGANIZATION_ROLE_ASSIGNMENT_LIMITED_SYSTEM_KEYS,
  ORGANIZATION_ROLE_ASSIGNMENT_PROTECTED_PERMISSIONS,
  ORGANIZATION_ROLE_KEYS,
} from '../access-control/rbac.constants';
import { EnvSuperAdminService } from '../auth/env-super-admin.service';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AcceptInviteWithTemporaryPasswordDto } from './dto/accept-invite-with-temporary-password.dto';
import { InviteOrganizationMemberDto } from './dto/invite-organization-member.dto';
import {
  ORGANIZATION_INVITE_TEMPORARY_PASSWORD_TTL_HOURS,
  ORGANIZATION_INVITE_TTL_DAYS,
} from './organization-defaults';

const TEMPORARY_PASSWORD_HASH_ROUNDS = 12;
const TEMPORARY_PASSWORD_LENGTH = 12;
const TEMPORARY_PASSWORD_CHARSET =
  'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

interface InviteRoleRecord {
  id: string;
  organizationId: string | null;
  name: string;
  isSystem: boolean;
}

interface AssignableInviteRoleRecord extends InviteRoleRecord {
  systemKey: string | null;
  permissions: Array<{
    permission: {
      code: string;
    };
  }>;
}

interface InviteRecord {
  id: string;
  organizationId: string;
  invitedName: string | null;
  email: string;
  status: OrganizationInviteStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  lastSentAt: Date | null;
  lastSendFailureAt: Date | null;
  lastSendFailureReason: string | null;
  temporaryPasswordHash: string | null;
  temporaryPasswordExpiresAt: Date | null;
  temporaryPasswordUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  organization: {
    id: string;
    name: string;
    slug: string;
    status: OrganizationStatus;
  };
  roles: Array<{
    role: InviteRoleRecord;
  }>;
}

export interface OrganizationInviteView {
  id: string;
  organizationId: string;
  name: string | null;
  email: string;
  status: OrganizationInviteStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  lastSentAt: Date | null;
  lastSendFailureAt: Date | null;
  lastSendFailureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  roles: InviteRoleRecord[];
}

export interface OrganizationInvitePreview {
  name: string | null;
  email: string;
  status: OrganizationInviteStatus;
  expiresAt: Date;
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  roles: InviteRoleRecord[];
}

export interface OrganizationInviteAcceptResult {
  message: string;
  data: {
    organization: {
      id: string;
      name: string;
      slug: string;
    };
    membershipId: string;
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeRoleIds(roleIds: string[] = []): string[] {
  return [...new Set(roleIds)].sort((left, right) => left.localeCompare(right));
}

function displayNameFromEmail(email: string): string {
  return email.split('@')[0]?.replace(/[._-]+/g, ' ') || email;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function generateTemporaryPassword(): string {
  return Array.from({ length: TEMPORARY_PASSWORD_LENGTH }, () => {
    const index = randomInt(0, TEMPORARY_PASSWORD_CHARSET.length);

    return TEMPORARY_PASSWORD_CHARSET[index];
  }).join('');
}

@Injectable()
export class OrganizationInvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly accessControlService: AccessControlService,
    private readonly envSuperAdminService: EnvSuperAdminService,
  ) {}

  async listInvites(organizationId: string): Promise<OrganizationInviteView[]> {
    const now = new Date();
    const invites = await this.prisma.organizationInvite.findMany({
      where: { organizationId },
      include: this.inviteInclude(organizationId),
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });

    return invites.map((invite) => this.toInviteView(invite, now));
  }

  async inviteMember(
    organizationId: string,
    actor: AuthenticatedPrincipal,
    dto: InviteOrganizationMemberDto,
    now = new Date(),
  ): Promise<OrganizationInviteView> {
    const email = normalizeEmail(dto.email);
    const roles = await this.resolveApplicableRoles(
      organizationId,
      actor.userId,
      dto.roleIds ?? [],
    );

    const invitee = await this.assertCanInviteEmail(email);
    const temporaryPassword = invitee.hasExistingAccount
      ? null
      : generateTemporaryPassword();
    const temporaryPasswordHash = temporaryPassword
      ? await hash(temporaryPassword, TEMPORARY_PASSWORD_HASH_ROUNDS)
      : null;
    const temporaryPasswordExpiresAt = temporaryPassword
      ? new Date(
          now.getTime() +
            ORGANIZATION_INVITE_TEMPORARY_PASSWORD_TTL_HOURS *
              60 *
              60 *
              1000,
        )
      : null;

    const token = randomUUID();
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(
      now.getTime() + ORGANIZATION_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const createdInvite = await this.prisma.$transaction(
      async (transaction) => {
        const organization = await transaction.organization.findUnique({
          where: { id: organizationId },
          select: { id: true, name: true, slug: true },
        });

        if (!organization) {
          throw new NotFoundException('Organization not found');
        }

        const invite = await transaction.organizationInvite.create({
          data: {
            organizationId,
            invitedName: dto.name,
            email,
            tokenHash,
            invitedByUserId: actor.userId,
            expiresAt,
            temporaryPasswordHash,
            temporaryPasswordExpiresAt,
          },
          include: this.inviteInclude(organizationId),
        });

        if (roles.length > 0) {
          await transaction.organizationInviteRole.createMany({
            data: roles.map((role) => ({
              inviteId: invite.id,
              roleId: role.id,
            })),
          });
        }

        return transaction.organizationInvite.findUniqueOrThrow({
          where: { id: invite.id },
          include: this.inviteInclude(organizationId),
        });
      },
    );

    let sentInvite: InviteRecord;

    try {
      await this.mailService.sendOrganizationInvite(
        email,
        createdInvite.organization.name,
        token,
        ORGANIZATION_INVITE_TTL_DAYS,
        {
          invitedName: dto.name,
          roleNames: roles.map((role) => role.name),
          temporaryPassword,
          temporaryPasswordExpiresInHours: temporaryPassword
            ? ORGANIZATION_INVITE_TEMPORARY_PASSWORD_TTL_HOURS
            : null,
        },
      );
      sentInvite = await this.prisma.organizationInvite.update({
        where: { id: createdInvite.id },
        data: {
          lastSentAt: new Date(),
          lastSendFailureAt: null,
          lastSendFailureReason: null,
        },
        include: this.inviteInclude(organizationId),
      });
    } catch (error: unknown) {
      await this.prisma.organizationInvite
        .updateMany({
          where: {
            id: createdInvite.id,
            status: OrganizationInviteStatus.PENDING,
          },
          data: {
            lastSendFailureAt: new Date(),
            lastSendFailureReason: this.getDeliveryFailureReason(error),
          },
        })
        .catch(() => {});

      throw new HttpException(
        {
          message:
            'Invitation was created, but the email could not be delivered. Check SMTP settings, then resend or revoke the invite.',
          details: { reason: 'INVITE_EMAIL_DELIVERY_FAILED' },
        },
        HttpStatus.FAILED_DEPENDENCY,
        { cause: error },
      );
    }

    await this.prisma.organizationInvite.updateMany({
      where: {
        id: { not: createdInvite.id },
        organizationId,
        email,
        status: OrganizationInviteStatus.PENDING,
        expiresAt: { gt: now },
      },
      data: {
        status: OrganizationInviteStatus.REVOKED,
        revokedAt: new Date(),
      },
    });

    return this.toInviteView(sentInvite);
  }

  async resendInvite(
    organizationId: string,
    inviteId: string,
    now = new Date(),
  ): Promise<OrganizationInviteView> {
    const existingInvite = await this.prisma.organizationInvite.findFirst({
      where: {
        id: inviteId,
        organizationId,
      },
      include: this.inviteInclude(organizationId),
    });

    if (!existingInvite) {
      throw new NotFoundException('Invitation not found');
    }

    const resolvedStatus = this.resolveInviteStatus(existingInvite, now);

    if (resolvedStatus === OrganizationInviteStatus.ACCEPTED) {
      throw new ConflictException('Accepted invitations cannot be resent.');
    }

    if (resolvedStatus === OrganizationInviteStatus.REVOKED) {
      throw new ConflictException('Revoked invitations cannot be resent.');
    }

    const token = randomUUID();
    const temporaryPassword = existingInvite.temporaryPasswordHash
      ? generateTemporaryPassword()
      : null;
    const temporaryPasswordHash = temporaryPassword
      ? await hash(temporaryPassword, TEMPORARY_PASSWORD_HASH_ROUNDS)
      : null;
    const temporaryPasswordExpiresAt = temporaryPassword
      ? new Date(
          now.getTime() +
            ORGANIZATION_INVITE_TEMPORARY_PASSWORD_TTL_HOURS *
              60 *
              60 *
              1000,
        )
      : null;
    const expiresAt = new Date(
      now.getTime() + ORGANIZATION_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const preparedInvite = await this.prisma.organizationInvite.update({
      where: { id: existingInvite.id },
      data: {
        tokenHash: this.hashToken(token),
        status: OrganizationInviteStatus.PENDING,
        expiresAt,
        revokedAt: null,
        ...(temporaryPasswordHash
          ? {
              temporaryPasswordHash,
              temporaryPasswordExpiresAt,
              temporaryPasswordUsedAt: null,
            }
          : {}),
        lastSendFailureAt: null,
        lastSendFailureReason: null,
      },
      include: this.inviteInclude(organizationId),
    });

    try {
      await this.mailService.sendOrganizationInvite(
        preparedInvite.email,
        preparedInvite.organization.name,
        token,
        ORGANIZATION_INVITE_TTL_DAYS,
        {
          invitedName: preparedInvite.invitedName,
          roleNames: preparedInvite.roles.map(({ role }) => role.name),
          temporaryPassword,
          temporaryPasswordExpiresInHours: temporaryPassword
            ? ORGANIZATION_INVITE_TEMPORARY_PASSWORD_TTL_HOURS
            : null,
        },
      );

      const sentInvite = await this.prisma.organizationInvite.update({
        where: { id: preparedInvite.id },
        data: {
          lastSentAt: new Date(),
          lastSendFailureAt: null,
          lastSendFailureReason: null,
        },
        include: this.inviteInclude(organizationId),
      });

      return this.toInviteView(sentInvite);
    } catch (error: unknown) {
      await this.prisma.organizationInvite
        .updateMany({
          where: { id: preparedInvite.id },
          data: {
            lastSendFailureAt: new Date(),
            lastSendFailureReason: this.getDeliveryFailureReason(error),
          },
        })
        .catch(() => {});

      throw new HttpException(
        {
          message:
            'Invitation email could not be delivered. Check SMTP settings and try again.',
          details: { reason: 'INVITE_EMAIL_DELIVERY_FAILED' },
        },
        HttpStatus.FAILED_DEPENDENCY,
        { cause: error },
      );
    }
  }

  async revokeInvite(organizationId: string, inviteId: string): Promise<void> {
    const revoked = await this.prisma.organizationInvite.updateMany({
      where: {
        id: inviteId,
        organizationId,
        status: OrganizationInviteStatus.PENDING,
      },
      data: {
        status: OrganizationInviteStatus.REVOKED,
        revokedAt: new Date(),
      },
    });

    if (revoked.count !== 1) {
      throw new NotFoundException('Pending invite not found');
    }
  }

  async previewInvite(token: string, now = new Date()) {
    const invite = await this.findInviteByToken(token);

    return {
      data: this.toInvitePreview(invite, now),
    };
  }

  async acceptInvite(
    token: string,
    principal: AuthenticatedPrincipal,
    now = new Date(),
  ): Promise<OrganizationInviteAcceptResult> {
    if (!principal.isVerified) {
      throw new ForbiddenException({
        message: 'Verify your email before accepting this invitation.',
        details: { reason: 'EMAIL_NOT_VERIFIED' },
      });
    }

    const invite = await this.findInviteByToken(token);
    this.assertInviteCanBeAccepted(invite, now);
    this.assertInviteOrganizationActive(invite);
    const inviteRoles = await this.resolveInviteRolesForAcceptance(invite);

    if (invite.email !== normalizeEmail(principal.email)) {
      throw new ForbiddenException({
        message: 'This invitation was sent to a different email address.',
        details: {
          reason: 'INVITE_EMAIL_MISMATCH',
          invitedEmail: invite.email,
          signedInEmail: normalizeEmail(principal.email),
        },
      });
    }

    if (await this.userHasSuperAdminRole(principal.userId)) {
      throw new ForbiddenException({
        message:
          'Super Admin accounts manage organizations from the platform level and cannot become organization members.',
        details: {
          reason: 'PLATFORM_ADMIN_CANNOT_ACCEPT_ORGANIZATION_INVITE',
        },
      });
    }

    await this.assertUserCanReceiveOrganizationRole(principal.userId);

    const membershipId = await this.prisma.$transaction(
      async (transaction) => {
        const existingMembership =
          await transaction.organizationMembership.findUnique({
            where: {
              organizationId_userId: {
                organizationId: invite.organizationId,
                userId: principal.userId,
              },
            },
            select: {
              id: true,
              status: true,
            },
          });

        const claimedInvite = await transaction.organizationInvite.updateMany({
          where: {
            id: invite.id,
            status: OrganizationInviteStatus.PENDING,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: {
            status: OrganizationInviteStatus.ACCEPTED,
            acceptedAt: now,
            acceptedByUserId: principal.userId,
          },
        });

        if (claimedInvite.count !== 1) {
          throw new ConflictException(
            'This invitation is no longer available.',
          );
        }

        if (invite.invitedName) {
          await transaction.user.updateMany({
            where: {
              id: principal.userId,
              OR: [{ name: null }, { name: '' }],
            },
            data: { name: invite.invitedName },
          });
        }

        const membership = existingMembership
          ? await transaction.organizationMembership.update({
              where: { id: existingMembership.id },
              data: { status: OrganizationMembershipStatus.ACTIVE },
              select: { id: true },
            })
          : await transaction.organizationMembership.create({
              data: {
                organizationId: invite.organizationId,
                userId: principal.userId,
                status: OrganizationMembershipStatus.ACTIVE,
              },
              select: { id: true },
            });

        await transaction.membershipRole.deleteMany({
          where: { membershipId: membership.id },
        });
        await transaction.membershipRole.create({
          data: {
            membershipId: membership.id,
            roleId: inviteRoles[0].id,
            assignedByUserId: invite.invitedByUserId,
          },
        });

        return membership.id;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    await this.accessControlService.invalidateUserAccess(principal.userId);

    return {
      message: 'Invitation accepted. The organization is now available.',
      data: {
        organization: invite.organization,
        membershipId,
      },
    };
  }

  async acceptInviteWithTemporaryPassword(
    dto: AcceptInviteWithTemporaryPasswordDto,
    now = new Date(),
  ): Promise<OrganizationInviteAcceptResult> {
    const email = normalizeEmail(dto.email);

    if (this.envSuperAdminService.isConfiguredEmail(email)) {
      throw new ForbiddenException({
        message:
          'Super Admin accounts manage organizations from the platform level and cannot become organization members.',
        details: {
          reason: 'PLATFORM_ADMIN_CANNOT_JOIN_ORGANIZATION',
        },
      });
    }

    const invite = await this.findInviteByToken(dto.token);
    this.assertInviteCanBeAccepted(invite, now);
    this.assertInviteOrganizationActive(invite);
    const inviteRoles = await this.resolveInviteRolesForAcceptance(invite);

    if (invite.email !== email) {
      throw new ForbiddenException({
        message: 'This invitation was sent to a different email address.',
        details: {
          reason: 'INVITE_EMAIL_MISMATCH',
          invitedEmail: invite.email,
          submittedEmail: email,
        },
      });
    }

    if (!invite.temporaryPasswordHash || !invite.temporaryPasswordExpiresAt) {
      throw new ForbiddenException(
        'This invitation belongs to an existing account. Sign in to accept it.',
      );
    }

    if (invite.temporaryPasswordUsedAt) {
      throw new ConflictException(
        'This invitation password has already been used.',
      );
    }

    if (invite.temporaryPasswordExpiresAt.getTime() <= now.getTime()) {
      throw new GoneException(
        'This invitation password has expired. Ask an administrator to resend the invitation.',
      );
    }

    const temporaryPasswordMatches = await compare(
      dto.temporaryPassword,
      invite.temporaryPasswordHash,
    );

    if (!temporaryPasswordMatches) {
      throw new ForbiddenException('Temporary password is incorrect.');
    }

    const passwordHash = await hash(
      dto.newPassword,
      TEMPORARY_PASSWORD_HASH_ROUNDS,
    );

    let accepted: {
      membershipId: string;
      userId: string;
    };

    try {
      accepted = await this.prisma.$transaction(
        async (transaction) => {
          const existingUser = await transaction.user.findUnique({
            where: { email },
            select: { id: true },
          });

          if (existingUser) {
            throw new ConflictException(
              'An account already exists for this email. Sign in to accept the invitation.',
            );
          }

          const user = await transaction.user.create({
            data: {
              name: invite.invitedName ?? displayNameFromEmail(email),
              email,
              passwordHash,
              isVerified: true,
              isActive: true,
            },
            select: { id: true },
          });

          const claimedInvite = await transaction.organizationInvite.updateMany({
            where: {
              id: invite.id,
              status: OrganizationInviteStatus.PENDING,
              acceptedAt: null,
              revokedAt: null,
              temporaryPasswordUsedAt: null,
              temporaryPasswordExpiresAt: { gt: now },
              expiresAt: { gt: now },
            },
            data: {
              status: OrganizationInviteStatus.ACCEPTED,
              acceptedAt: now,
              acceptedByUserId: user.id,
              temporaryPasswordUsedAt: now,
            },
          });

          if (claimedInvite.count !== 1) {
            throw new ConflictException(
              'This invitation is no longer available.',
            );
          }

          const membership = await transaction.organizationMembership.create({
            data: {
              organizationId: invite.organizationId,
              userId: user.id,
              status: OrganizationMembershipStatus.ACTIVE,
            },
            select: { id: true },
          });

          await transaction.membershipRole.create({
            data: {
              membershipId: membership.id,
              roleId: inviteRoles[0].id,
              assignedByUserId: invite.invitedByUserId,
            },
          });

          return {
            membershipId: membership.id,
            userId: user.id,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          'An account already exists for this email. Sign in to accept the invitation.',
        );
      }

      throw error;
    }

    await this.accessControlService.invalidateUserAccess(accepted.userId);

    return {
      message:
        'Invitation accepted. Your account is ready; sign in with your new password.',
      data: {
        organization: invite.organization,
        membershipId: accepted.membershipId,
      },
    };
  }

  private async assertCanInviteEmail(
    email: string,
  ): Promise<{ hasExistingAccount: boolean }> {
    if (this.envSuperAdminService.isConfiguredEmail(email)) {
      throw new ConflictException({
        message:
          'Super Admin accounts operate from the platform level and cannot become organization members.',
        details: {
          reason: 'PLATFORM_ADMIN_CANNOT_JOIN_ORGANIZATION',
        },
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        isActive: true,
        platformRoleAssignments: {
          where: {
            role: {
              is: {
                scope: AccessScope.PLATFORM,
                isActive: true,
              },
            },
          },
          select: { roleId: true },
          take: 1,
        },
        organizationMemberships: {
          where: {
            status: {
              in: [
                OrganizationMembershipStatus.ACTIVE,
                OrganizationMembershipStatus.SUSPENDED,
              ],
            },
          },
          select: {
            id: true,
        organization: {
              select: {
                name: true,
              },
            },
          },
          take: 1,
        },
      },
    });

    if (user && user.platformRoleAssignments.length > 0) {
      throw new ConflictException(
        'This user already has a platform role and cannot receive an organization role.',
      );
    }

    if (user && !user.isActive) {
      throw new ConflictException(
        'This account is inactive and cannot be invited.',
      );
    }

    if (user && user.organizationMemberships.length > 0) {
      throw new ConflictException(
        `This user already has a role in ${user.organizationMemberships[0].organization.name}. A user can have only one role globally.`,
      );
    }

    return { hasExistingAccount: Boolean(user) };
  }

  private async resolveApplicableRoles(
    organizationId: string,
    actorUserId: string,
    roleIdsInput: string[],
  ): Promise<AssignableInviteRoleRecord[]> {
    const roleIds = normalizeRoleIds(roleIdsInput);

    if (roleIds.length !== 1) {
      throw new BadRequestException(
        'Select exactly one role. A user can have only one role globally.',
      );
    }

    const roles = await this.prisma.role.findMany({
      where: {
        id: { in: roleIds },
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
    const resolvedRoleIds = new Set(roles.map((role) => role.id));
    const invalidRoleIds = roleIds.filter(
      (roleId) => !resolvedRoleIds.has(roleId),
    );

    if (invalidRoleIds.length > 0) {
      throw new ConflictException({
        message: 'One or more roles are invalid, inactive, or unavailable',
        details: { invalidRoleIds },
      });
    }

    await this.assertRolesAssignableByActor(actorUserId, roles);

    return roles;
  }

  private async assertRolesAssignableByActor(
    actorUserId: string,
    roles: AssignableInviteRoleRecord[],
  ): Promise<void> {
    if (roles.length === 0 || (await this.userHasSuperAdminRole(actorUserId))) {
      return;
    }

    const blockedRoles = roles.filter(
      (role) => !this.isAssignableByOrganizationAdmin(role),
    );

    if (blockedRoles.length > 0) {
      throw new ForbiddenException({
        message:
          'Organization Admins can invite users only as Manager, Employee, Viewer, or non-admin custom roles.',
        details: {
          blockedRoleIds: blockedRoles.map((role) => role.id),
        },
      });
    }
  }

  private isAssignableByOrganizationAdmin(
    role: AssignableInviteRoleRecord,
  ): boolean {
    if (role.systemKey === ORGANIZATION_ROLE_KEYS.organizationAdmin) {
      return false;
    }

    if (role.systemKey) {
      return ORGANIZATION_ROLE_ASSIGNMENT_LIMITED_SYSTEM_KEYS.has(
        role.systemKey,
      );
    }

    return !role.permissions.some(({ permission }) =>
      ORGANIZATION_ROLE_ASSIGNMENT_PROTECTED_PERMISSIONS.has(permission.code),
    );
  }

  private async findInviteByToken(token: string): Promise<
    InviteRecord & {
      invitedByUserId: string | null;
    }
  > {
    const invite = await this.prisma.organizationInvite.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: this.inviteInclude(null),
    });

    if (!invite) {
      throw new NotFoundException('Invitation not found');
    }

    return invite;
  }

  private async resolveInviteRolesForAcceptance(
    invite: InviteRecord & { invitedByUserId: string | null },
  ): Promise<AssignableInviteRoleRecord[]> {
    const roleIds = normalizeRoleIds(
      invite.roles.map(({ role }) => role.id),
    );

    if (roleIds.length !== 1) {
      throw new ConflictException(
        'This invitation must contain exactly one active role. Ask an administrator to resend it.',
      );
    }

    const roles = await this.prisma.role.findMany({
      where: {
        id: { in: roleIds },
        scope: AccessScope.ORGANIZATION,
        isActive: true,
        OR: [{ organizationId: null }, { organizationId: invite.organizationId }],
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
    const resolvedRoleIds = new Set(roles.map((role) => role.id));
    const invalidRoleIds = roleIds.filter(
      (roleId) => !resolvedRoleIds.has(roleId),
    );

    if (invalidRoleIds.length > 0) {
      throw new ConflictException({
        message: 'One or more invitation roles are no longer available.',
        details: { invalidRoleIds },
      });
    }

    if (
      !invite.invitedByUserId ||
      !(await this.userHasSuperAdminRole(invite.invitedByUserId))
    ) {
      const blockedRoles = roles.filter(
        (role) => !this.isAssignableByOrganizationAdmin(role),
      );

      if (blockedRoles.length > 0) {
        throw new ForbiddenException({
          message:
            'This invitation contains a role that only Super Admin can assign. Ask a Super Admin to resend it.',
          details: {
            blockedRoleIds: blockedRoles.map((role) => role.id),
          },
        });
      }
    }

    return roles;
  }

  private assertInviteCanBeAccepted(invite: InviteRecord, now: Date): void {
    if (
      invite.status === OrganizationInviteStatus.ACCEPTED ||
      invite.acceptedAt
    ) {
      throw new ConflictException('This invitation has already been accepted.');
    }

    if (
      invite.status === OrganizationInviteStatus.REVOKED ||
      invite.revokedAt
    ) {
      throw new ConflictException('This invitation has been revoked.');
    }

    if (
      invite.status === OrganizationInviteStatus.EXPIRED ||
      invite.expiresAt.getTime() <= now.getTime()
    ) {
      throw new GoneException('This invitation has expired.');
    }
  }

  private assertInviteOrganizationActive(invite: InviteRecord): void {
    if (invite.organization.status !== OrganizationStatus.ACTIVE) {
      throw new ForbiddenException(
        'This organization is suspended and cannot accept invitations.',
      );
    }
  }

  private inviteInclude(organizationId: string | null) {
    return {
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
        },
      },
      roles: {
        where: organizationId
          ? {
              role: {
                is: {
                  scope: AccessScope.ORGANIZATION,
                  isActive: true,
                  OR: [{ organizationId: null }, { organizationId }],
                },
              },
            }
          : undefined,
        select: {
          role: {
            select: {
              id: true,
              organizationId: true,
              name: true,
              isSystem: true,
            },
          },
        },
      },
    } as const;
  }

  private toInviteView(
    invite: InviteRecord,
    now = new Date(),
  ): OrganizationInviteView {
    return {
      id: invite.id,
      organizationId: invite.organizationId,
      email: invite.email,
      name: invite.invitedName,
      status: this.resolveInviteStatus(invite, now),
      expiresAt: invite.expiresAt,
      acceptedAt: invite.acceptedAt,
      revokedAt: invite.revokedAt,
      lastSentAt: invite.lastSentAt,
      lastSendFailureAt: invite.lastSendFailureAt,
      lastSendFailureReason: invite.lastSendFailureReason,
      createdAt: invite.createdAt,
      updatedAt: invite.updatedAt,
      roles: invite.roles
        .map(({ role }) => role)
        .sort(
          (left, right) =>
            left.name.localeCompare(right.name) ||
            left.id.localeCompare(right.id),
        ),
    };
  }

  private toInvitePreview(
    invite: InviteRecord,
    now: Date,
  ): OrganizationInvitePreview {
    return {
      email: invite.email,
      name: invite.invitedName,
      status: this.resolveInviteStatus(invite, now),
      expiresAt: invite.expiresAt,
      organization: invite.organization,
      roles: invite.roles.map(({ role }) => role),
    };
  }

  private resolveInviteStatus(
    invite: InviteRecord,
    now: Date,
  ): OrganizationInviteStatus {
    if (
      invite.status === OrganizationInviteStatus.PENDING &&
      invite.expiresAt.getTime() <= now.getTime()
    ) {
      return OrganizationInviteStatus.EXPIRED;
    }

    return invite.status;
  }

  private getDeliveryFailureReason(error: unknown): string {
    if (error instanceof Error) {
      return error.message.slice(0, 500);
    }

    return 'Email delivery failed';
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async assertUserCanReceiveOrganizationRole(
    userId: string,
  ): Promise<void> {
    if (await this.envSuperAdminService.isConfiguredUserId(userId)) {
      throw new ConflictException({
        message:
          'Super Admin accounts operate from the platform level and cannot become organization members.',
        details: {
          reason: 'PLATFORM_ADMIN_CANNOT_JOIN_ORGANIZATION',
        },
      });
    }

    const [platformRole, existingMembership] = await Promise.all([
      this.prisma.platformUserRole.findFirst({
        where: {
          userId,
          role: {
            is: {
              scope: AccessScope.PLATFORM,
              isActive: true,
            },
          },
        },
        select: { roleId: true },
      }),
      this.prisma.organizationMembership.findFirst({
        where: {
          userId,
          status: {
            in: [
              OrganizationMembershipStatus.ACTIVE,
              OrganizationMembershipStatus.SUSPENDED,
            ],
          },
        },
        select: {
          id: true,
          organization: {
            select: {
              name: true,
            },
          },
        },
      }),
    ]);

    if (platformRole) {
      throw new ConflictException(
        'This user already has a platform role and cannot receive an organization role.',
      );
    }

    if (existingMembership) {
      throw new ConflictException(
        `This user already has a role in ${existingMembership.organization.name}. A user can have only one role globally.`,
      );
    }
  }

  private async userHasSuperAdminRole(userId: string): Promise<boolean> {
    return this.envSuperAdminService.isConfiguredUserId(userId);
  }
}
