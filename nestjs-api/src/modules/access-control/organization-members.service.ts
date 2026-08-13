import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessScope,
  JoinRequestStatus,
  OrganizationInviteStatus,
  OrganizationMembershipStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EnvSuperAdminService } from '../auth/env-super-admin.service';
import { AccessControlService } from './access-control.service';
import { AddOrganizationMemberDto } from './dto/add-organization-member.dto';
import { ListMembersQueryDto } from './dto/list-members-query.dto';
import { ListPeopleAccessQueryDto } from './dto/list-people-access-query.dto';
import {
  ORGANIZATION_PERMISSIONS,
  ORGANIZATION_ROLE_ASSIGNMENT_LIMITED_SYSTEM_KEYS,
  ORGANIZATION_ROLE_KEYS,
  PLATFORM_ROLE_KEYS,
} from './rbac.constants';

const MEMBER_MANAGEMENT_PERMISSION = ORGANIZATION_PERMISSIONS.membersManage;
const MEMBER_VISIBILITY_TIER = {
  none: 0,
  employee: 1,
  manager: 2,
  organizationAdmin: 3,
  platform: 4,
} as const;

type MemberVisibilityTier =
  (typeof MEMBER_VISIBILITY_TIER)[keyof typeof MEMBER_VISIBILITY_TIER];

interface MemberRoleRecord {
  id: string;
  organizationId: string | null;
  systemKey: string | null;
  name: string;
  isSystem: boolean;
  permissions: Array<{
    permission: {
      code: string;
    };
  }>;
}

interface MembershipRecord {
  id: string;
  organizationId: string;
  userId: string;
  status: OrganizationMembershipStatus;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    name: string | null;
    email: string;
    isVerified: boolean;
    isActive: boolean;
  };
  roles: Array<{
    role: MemberRoleRecord;
  }>;
}

interface PeopleInviteRecord {
  id: string;
  organizationId: string;
  invitedName: string | null;
  email: string;
  status: OrganizationInviteStatus;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  revocationReason: string | null;
  lastSentAt: Date | null;
  lastSendFailureAt: Date | null;
  lastSendFailureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  roles: Array<{
    role: {
      id: string;
      organizationId: string | null;
      systemKey: string | null;
      name: string;
      isSystem: boolean;
    };
  }>;
}

interface PeopleJoinRequestRecord {
  id: string;
  userId: string;
  organizationId: string;
  message: string | null;
  status: JoinRequestStatus;
  rejectionReason: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: string;
    name: string | null;
    email: string;
    isVerified: boolean;
    isActive: boolean;
  };
  organization: PeopleAccessOrganizationView;
}

export interface MemberRoleView {
  id: string;
  organizationId: string | null;
  systemKey: string | null;
  name: string;
  isSystem: boolean;
}

export interface OrganizationMemberView {
  id: string;
  organizationId: string;
  status: OrganizationMembershipStatus;
  user: {
    id: string;
    name: string | null;
    email: string;
    isVerified: boolean;
  };
  roles: MemberRoleView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMemberListResult {
  members: OrganizationMemberView[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}

type PeopleAccessSource = 'member' | 'invite' | 'request';

interface PeopleAccessOrganizationView {
  id: string;
  name: string;
  slug: string;
}

export interface PeopleAccessRoleView {
  id: string;
  organizationId: string | null;
  systemKey?: string | null;
  name: string;
  isSystem: boolean;
}

export interface PeopleAccessRowView {
  id: string;
  raw: Record<string, unknown>;
  source: PeopleAccessSource;
  sourceLabel: 'Member' | 'Invite' | 'Request';
  name: string;
  email: string;
  organization: PeopleAccessOrganizationView;
  role: PeopleAccessRoleView | null;
  roleName: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  detail: string;
}

export interface PeopleAccessListResult {
  rows: PeopleAccessRowView[];
  summary: {
    total: number;
    members: number;
    invites: number;
    requests: number;
  };
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeRoleIds(roleIds: string[]): string[] {
  return [...new Set(roleIds)].sort((left, right) => left.localeCompare(right));
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function isRetryableTransactionError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2034'
  );
}

@Injectable()
export class OrganizationMembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
    private readonly envSuperAdminService: EnvSuperAdminService,
  ) {}

  async listMembers(
    organizationId: string,
    actorUserId?: string,
    query: ListMembersQueryDto = {},
  ): Promise<OrganizationMemberListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const memberships = await this.prisma.organizationMembership.findMany({
      where: this.buildMemberWhere(organizationId, query),
      select: this.membershipSelect(organizationId),
      orderBy: [{ user: { email: 'asc' } }, { id: 'asc' }],
    });
    const visibleMemberships = actorUserId
      ? await this.filterVisibleMembershipsForActor(
          organizationId,
          actorUserId,
          memberships,
        )
      : memberships;
    const total = visibleMemberships.length;
    const pagedMemberships = visibleMemberships.slice(
      (page - 1) * pageSize,
      page * pageSize,
    );

    return {
      members: pagedMemberships.map((membership) =>
        this.toMemberView(membership),
      ),
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(Math.ceil(total / pageSize), 1),
      },
    };
  }

  async listPeopleAccess(
    organizationId: string,
    actorUserId: string,
    query: ListPeopleAccessQueryDto = {},
  ): Promise<PeopleAccessListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const source = query.source ?? 'all';
    const now = new Date();
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, slug: true },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const actorTier = await this.resolveActorMemberVisibilityTier(
      organizationId,
      actorUserId,
    );
    const canManageMembers =
      actorTier >= MEMBER_VISIBILITY_TIER.organizationAdmin;
    const includeMembers = source === 'all' || source === 'member';
    const includeInvites =
      canManageMembers && (source === 'all' || source === 'invite');
    const includeRequests =
      canManageMembers &&
      !query.roleId &&
      (source === 'all' || source === 'request');

    if (actorTier < MEMBER_VISIBILITY_TIER.manager) {
      throw new ForbiddenException(
        'Your current role cannot view organization people.',
      );
    }

    const memberWhere = this.buildPeopleMemberWhere(organizationId, query);
    const inviteWhere = this.buildPeopleInviteWhere(organizationId, query, now);
    const requestWhere = this.buildPeopleRequestWhere(organizationId, query);
    const memberCandidates =
      includeMembers && actorTier < MEMBER_VISIBILITY_TIER.organizationAdmin
        ? await this.prisma.organizationMembership.findMany({
            where: memberWhere,
            select: this.membershipSelect(organizationId),
            orderBy: [{ user: { email: 'asc' } }, { id: 'asc' }],
          })
        : null;
    const visibleMemberCandidates = memberCandidates
      ? this.filterMembershipsForTier(
          actorTier,
          actorUserId,
          memberCandidates,
        )
      : null;
    const [memberTotal, inviteTotal, requestTotal] = await Promise.all([
      includeMembers
        ? visibleMemberCandidates
          ? Promise.resolve(visibleMemberCandidates.length)
          : this.prisma.organizationMembership.count({ where: memberWhere })
        : Promise.resolve(0),
      includeInvites
        ? this.prisma.organizationInvite.count({ where: inviteWhere })
        : Promise.resolve(0),
      includeRequests
        ? this.prisma.joinRequest.count({ where: requestWhere })
        : Promise.resolve(0),
    ]);
    const sourcePlans = this.planPeopleAccessPage(
      [
        { source: 'member', total: memberTotal },
        { source: 'invite', total: inviteTotal },
        { source: 'request', total: requestTotal },
      ],
      page,
      pageSize,
    );
    const [members, invites, requests] = await Promise.all([
      sourcePlans.member.take > 0
        ? visibleMemberCandidates
          ? Promise.resolve(
              visibleMemberCandidates.slice(
                sourcePlans.member.skip,
                sourcePlans.member.skip + sourcePlans.member.take,
              ),
            )
          : this.prisma.organizationMembership.findMany({
              where: memberWhere,
              select: this.membershipSelect(organizationId),
              orderBy: [{ user: { email: 'asc' } }, { id: 'asc' }],
              skip: sourcePlans.member.skip,
              take: sourcePlans.member.take,
            })
        : Promise.resolve([]),
      sourcePlans.invite.take > 0
        ? this.prisma.organizationInvite.findMany({
            where: inviteWhere,
            select: this.peopleInviteSelect(organizationId),
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: sourcePlans.invite.skip,
            take: sourcePlans.invite.take,
          })
        : Promise.resolve([]),
      sourcePlans.request.take > 0
        ? this.prisma.joinRequest.findMany({
            where: requestWhere,
            select: this.peopleJoinRequestSelect(),
            orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
            skip: sourcePlans.request.skip,
            take: sourcePlans.request.take,
          })
        : Promise.resolve([]),
    ]);
    const rows = [
      ...members.map((membership) =>
        this.toPeopleMemberRow(membership, organization),
      ),
      ...invites.map((invite) =>
        this.toPeopleInviteRow(invite, organization, now),
      ),
      ...requests.map((request) => this.toPeopleRequestRow(request)),
    ];
    const total = memberTotal + inviteTotal + requestTotal;

    return {
      rows,
      summary: {
        total,
        members: memberTotal,
        invites: inviteTotal,
        requests: requestTotal,
      },
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(Math.ceil(total / pageSize), 1),
      },
    };
  }

  async getMember(
    organizationId: string,
    membershipId: string,
    actorUserId?: string,
  ): Promise<OrganizationMemberView> {
    const membership = await this.findCurrentMembership(
      organizationId,
      membershipId,
    );

    if (!membership) {
      throw new NotFoundException('Organization member not found');
    }

    if (
      actorUserId &&
      !(await this.canActorViewMembership(
        organizationId,
        actorUserId,
        membership,
      ))
    ) {
      throw new NotFoundException('Organization member not found');
    }

    return this.toMemberView(membership);
  }

  async addMember(
    organizationId: string,
    actorUserId: string,
    dto: AddOrganizationMemberDto,
  ): Promise<OrganizationMemberView> {
    const user = await this.prisma.user.findFirst({
      where: {
        email: normalizeEmail(dto.email),
        isVerified: true,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        platformRoleAssignments: {
          where: {
            role: {
              is: {
                systemKey: PLATFORM_ROLE_KEYS.superAdmin,
                scope: AccessScope.PLATFORM,
                isActive: true,
              },
            },
          },
          select: { roleId: true },
          take: 1,
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Active verified user not found');
    }

    if (
      this.envSuperAdminService.isConfiguredUser(user) ||
      user.platformRoleAssignments.length > 0
    ) {
      throw new ConflictException({
        message:
          'Super Admin accounts operate from the platform level and cannot become organization members.',
        details: {
          reason: 'PLATFORM_ADMIN_CANNOT_JOIN_ORGANIZATION',
        },
      });
    }

    if (user.id === actorUserId) {
      throw new ForbiddenException(
        'You cannot add your own account from member management',
      );
    }

    const roles = await this.resolveApplicableRoles(
      organizationId,
      actorUserId,
      dto.roleIds ?? [],
    );
    const existingMembership =
      await this.prisma.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId: user.id,
          },
        },
        select: {
          id: true,
          status: true,
        },
      });

    if (
      existingMembership &&
      existingMembership.status !== OrganizationMembershipStatus.REMOVED
    ) {
      throw new ConflictException(
        'User is already a current organization member',
      );
    }

    await this.assertUserCanReceiveOrganizationRole(user.id);

    let membershipId: string;

    try {
      membershipId = await this.prisma.$transaction(async (transaction) => {
        const membership = existingMembership
          ? await transaction.organizationMembership.update({
              where: { id: existingMembership.id },
              data: {
                status: OrganizationMembershipStatus.ACTIVE,
              },
              select: { id: true },
            })
          : await transaction.organizationMembership.create({
              data: {
                organizationId,
                userId: user.id,
                status: OrganizationMembershipStatus.ACTIVE,
              },
              select: { id: true },
            });

        if (existingMembership) {
          await transaction.membershipRole.deleteMany({
            where: { membershipId: membership.id },
          });
        }

        if (roles.length > 0) {
          await transaction.membershipRole.createMany({
            data: roles.map((role) => ({
              membershipId: membership.id,
              roleId: role.id,
              assignedByUserId: actorUserId,
            })),
          });
        }

        return membership.id;
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          'User is already a current organization member',
        );
      }

      throw error;
    }

    await this.accessControlService.invalidateUserAccess(user.id);

    return this.getMember(organizationId, membershipId);
  }

  async replaceMemberRoles(
    organizationId: string,
    membershipId: string,
    actorUserId: string,
    roleIdsInput: string[],
  ): Promise<OrganizationMemberView> {
    const membership = await this.requireCurrentMembership(
      organizationId,
      membershipId,
    );

    if (membership.userId === actorUserId) {
      throw new ForbiddenException(
        'You cannot change your own organization roles',
      );
    }

    await this.assertActorCanManageTargetMember(
      actorUserId,
      membership.roles.map(({ role }) => role),
    );

    const roles = await this.resolveApplicableRoles(
      organizationId,
      actorUserId,
      roleIdsInput,
    );
    await this.assertUserCanReceiveOrganizationRole(
      membership.userId,
      membershipId,
    );
    const currentlyManagesUsers =
      membership.status === OrganizationMembershipStatus.ACTIVE &&
      this.rolesGrantUserManagement(membership.roles.map(({ role }) => role));
    const willManageUsers = this.rolesGrantUserManagement(roles);

    await this.runSerializableMembershipMutation(async (transaction) => {
      if (currentlyManagesUsers && !willManageUsers) {
        await this.ensureAnotherUserManager(
          transaction,
          organizationId,
          membershipId,
        );
      }

      await transaction.membershipRole.deleteMany({
        where: { membershipId },
      });

      if (roles.length > 0) {
        await transaction.membershipRole.createMany({
          data: roles.map((role) => ({
            membershipId,
            roleId: role.id,
            assignedByUserId: actorUserId,
          })),
        });
      }
    });

    await this.accessControlService.invalidateUserAccess(membership.userId);

    return this.getMember(organizationId, membershipId);
  }

  async updateMemberStatus(
    organizationId: string,
    membershipId: string,
    actorUserId: string,
    status:
      | typeof OrganizationMembershipStatus.ACTIVE
      | typeof OrganizationMembershipStatus.SUSPENDED,
  ): Promise<OrganizationMemberView> {
    const membership = await this.requireCurrentMembership(
      organizationId,
      membershipId,
    );

    if (membership.userId === actorUserId) {
      throw new ForbiddenException(
        'You cannot suspend or reactivate your own organization membership',
      );
    }

    await this.assertActorCanManageTargetMember(
      actorUserId,
      membership.roles.map(({ role }) => role),
    );

    if (membership.status === status) {
      return this.toMemberView(membership);
    }

    await this.runSerializableMembershipMutation(async (transaction) => {
      if (
        status === OrganizationMembershipStatus.SUSPENDED &&
        membership.status === OrganizationMembershipStatus.ACTIVE &&
        this.rolesGrantUserManagement(membership.roles.map(({ role }) => role))
      ) {
        await this.ensureAnotherUserManager(
          transaction,
          organizationId,
          membershipId,
        );
      }

      await transaction.organizationMembership.update({
        where: { id: membershipId },
        data: { status },
      });
    });
    await this.accessControlService.invalidateUserAccess(membership.userId);

    return this.getMember(organizationId, membershipId);
  }

  async removeMember(
    organizationId: string,
    membershipId: string,
    actorUserId: string,
  ): Promise<void> {
    const membership = await this.requireCurrentMembership(
      organizationId,
      membershipId,
    );

    if (membership.userId === actorUserId) {
      throw new ForbiddenException(
        'You cannot remove your own organization membership',
      );
    }

    await this.assertActorCanManageTargetMember(
      actorUserId,
      membership.roles.map(({ role }) => role),
    );

    await this.runSerializableMembershipMutation(async (transaction) => {
      if (
        membership.status === OrganizationMembershipStatus.ACTIVE &&
        this.rolesGrantUserManagement(membership.roles.map(({ role }) => role))
      ) {
        await this.ensureAnotherUserManager(
          transaction,
          organizationId,
          membershipId,
        );
      }

      await transaction.membershipRole.deleteMany({
        where: { membershipId },
      });
      await transaction.organizationMembership.update({
        where: { id: membershipId },
        data: {
          status: OrganizationMembershipStatus.REMOVED,
        },
      });
    });

    await this.accessControlService.invalidateUserAccess(membership.userId);
  }

  private planPeopleAccessPage(
    sources: Array<{ source: PeopleAccessSource; total: number }>,
    page: number,
    pageSize: number,
  ): Record<PeopleAccessSource, { skip: number; take: number }> {
    let offset = (page - 1) * pageSize;
    let remaining = pageSize;
    const plan: Record<PeopleAccessSource, { skip: number; take: number }> = {
      invite: { skip: 0, take: 0 },
      member: { skip: 0, take: 0 },
      request: { skip: 0, take: 0 },
    };

    for (const source of sources) {
      if (remaining <= 0) break;

      if (offset >= source.total) {
        offset -= source.total;
        continue;
      }

      const skip = offset;
      const take = Math.min(source.total - skip, remaining);

      plan[source.source] = { skip, take };
      remaining -= take;
      offset = 0;
    }

    return plan;
  }

  private filterMembershipsForTier(
    actorTier: MemberVisibilityTier,
    actorUserId: string,
    memberships: MembershipRecord[],
  ): MembershipRecord[] {
    if (actorTier >= MEMBER_VISIBILITY_TIER.organizationAdmin) {
      return memberships;
    }

    return memberships.filter(
      (membership) =>
        membership.userId !== actorUserId &&
        this.getMemberVisibilityTierFromRoles(membership.roles) ===
          MEMBER_VISIBILITY_TIER.employee,
    );
  }

  private buildPeopleMemberWhere(
    organizationId: string,
    query: ListPeopleAccessQueryDto,
  ): Prisma.OrganizationMembershipWhereInput {
    const search = query.search?.trim();
    const statusFilter =
      query.status === 'ACTIVE'
        ? [OrganizationMembershipStatus.ACTIVE]
        : query.status === 'SUSPENDED'
          ? [OrganizationMembershipStatus.SUSPENDED]
          : query.status && query.status !== 'all'
            ? []
            : [
                OrganizationMembershipStatus.ACTIVE,
                OrganizationMembershipStatus.SUSPENDED,
              ];

    return {
      organizationId,
      status: {
        in: statusFilter,
      },
      ...(query.roleId
        ? {
            roles: {
              some: {
                roleId: query.roleId,
              },
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              {
                user: {
                  is: {
                    email: {
                      contains: search,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                },
              },
              {
                user: {
                  is: {
                    name: {
                      contains: search,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                },
              },
              {
                roles: {
                  some: {
                    role: {
                      is: {
                        name: {
                          contains: search,
                          mode: Prisma.QueryMode.insensitive,
                        },
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  private buildPeopleInviteWhere(
    organizationId: string,
    query: ListPeopleAccessQueryDto,
    now: Date,
  ): Prisma.OrganizationInviteWhereInput {
    const search = query.search?.trim();

    return {
      organizationId,
      ...this.resolvePeopleInviteStatusWhere(query.status, now),
      ...(query.roleId
        ? {
            roles: {
              some: {
                roleId: query.roleId,
              },
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              {
                email: {
                  contains: search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                invitedName: {
                  contains: search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                roles: {
                  some: {
                    role: {
                      is: {
                        name: {
                          contains: search,
                          mode: Prisma.QueryMode.insensitive,
                        },
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  private buildPeopleRequestWhere(
    organizationId: string,
    query: ListPeopleAccessQueryDto,
  ): Prisma.JoinRequestWhereInput {
    const search = query.search?.trim();
    const status =
      query.status && query.status !== 'all'
        ? this.toJoinRequestStatus(query.status)
        : undefined;

    if (query.status && query.status !== 'all' && !status) {
      return {
        organizationId,
        id: '00000000-0000-0000-0000-000000000000',
      };
    }

    return {
      organizationId,
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              {
                user: {
                  is: {
                    email: {
                      contains: search,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                },
              },
              {
                user: {
                  is: {
                    name: {
                      contains: search,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                },
              },
              {
                message: {
                  contains: search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            ],
          }
        : {}),
    };
  }

  private resolvePeopleInviteStatusWhere(
    status: ListPeopleAccessQueryDto['status'],
    now: Date,
  ): Prisma.OrganizationInviteWhereInput {
    if (!status || status === 'all') {
      return {};
    }

    if (status === 'PENDING') {
      return {
        status: OrganizationInviteStatus.PENDING,
        expiresAt: { gt: now },
      };
    }

    if (status === 'EXPIRED') {
      return {
        OR: [
          { status: OrganizationInviteStatus.EXPIRED },
          {
            status: OrganizationInviteStatus.PENDING,
            expiresAt: { lte: now },
          },
        ],
      };
    }

    if (status === 'ACCEPTED') {
      return { status: OrganizationInviteStatus.ACCEPTED };
    }

    if (status === 'REVOKED') {
      return { status: OrganizationInviteStatus.REVOKED };
    }

    return {
      id: '00000000-0000-0000-0000-000000000000',
    };
  }

  private toJoinRequestStatus(
    status: ListPeopleAccessQueryDto['status'],
  ): JoinRequestStatus | null {
    if (status === 'PENDING') return JoinRequestStatus.PENDING;
    if (status === 'ACCEPTED') return JoinRequestStatus.ACCEPTED;
    if (status === 'REJECTED') return JoinRequestStatus.REJECTED;
    if (status === 'CANCELED') return JoinRequestStatus.CANCELED;

    return null;
  }

  private peopleInviteSelect(organizationId: string) {
    return {
      id: true,
      organizationId: true,
      invitedName: true,
      email: true,
      status: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      revocationReason: true,
      lastSentAt: true,
      lastSendFailureAt: true,
      lastSendFailureReason: true,
      createdAt: true,
      updatedAt: true,
      roles: {
        where: {
          role: {
            is: {
              scope: AccessScope.ORGANIZATION,
              isActive: true,
              OR: [{ organizationId: null }, { organizationId }],
            },
          },
        },
        select: {
          role: {
            select: {
              id: true,
              organizationId: true,
              systemKey: true,
              name: true,
              isSystem: true,
            },
          },
        },
      },
    } as const satisfies Prisma.OrganizationInviteSelect;
  }

  private peopleJoinRequestSelect() {
    return {
      id: true,
      userId: true,
      organizationId: true,
      message: true,
      status: true,
      rejectionReason: true,
      reviewedAt: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          isVerified: true,
          isActive: true,
        },
      },
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
    } as const satisfies Prisma.JoinRequestSelect;
  }

  private toPeopleMemberRow(
    membership: MembershipRecord,
    organization: PeopleAccessOrganizationView,
  ): PeopleAccessRowView {
    const member = this.toMemberView(membership);
    const role = member.roles[0] ?? null;

    return {
      id: `member:${member.id}`,
      raw: member as unknown as Record<string, unknown>,
      source: 'member',
      sourceLabel: 'Member',
      name: member.user.name ?? member.user.email,
      email: member.user.email,
      organization,
      role,
      roleName: role?.name ?? 'No role',
      status: member.status,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
      detail:
        member.status === OrganizationMembershipStatus.SUSPENDED
          ? 'Membership is suspended until an administrator reactivates it.'
          : 'Current organization member.',
    };
  }

  private toPeopleInviteRow(
    invite: PeopleInviteRecord,
    organization: PeopleAccessOrganizationView,
    now: Date,
  ): PeopleAccessRowView {
    const status = this.resolvePeopleInviteStatus(invite, now);
    const role = this.toPeopleRole(invite.roles[0]?.role ?? null);
    const raw = {
      id: invite.id,
      organizationId: invite.organizationId,
      name: invite.invitedName,
      email: invite.email,
      status,
      expiresAt: invite.expiresAt,
      acceptedAt: invite.acceptedAt,
      revokedAt: invite.revokedAt,
      revocationReason: invite.revocationReason,
      lastSentAt: invite.lastSentAt,
      lastSendFailureAt: invite.lastSendFailureAt,
      lastSendFailureReason: invite.lastSendFailureReason,
      createdAt: invite.createdAt,
      updatedAt: invite.updatedAt,
      roles: invite.roles.map(({ role: inviteRole }) =>
        this.toPeopleRole(inviteRole),
      ),
    };

    return {
      id: `invite:${invite.id}`,
      raw,
      source: 'invite',
      sourceLabel: 'Invite',
      name: invite.invitedName ?? invite.email,
      email: invite.email,
      organization,
      role,
      roleName: role?.name ?? 'No role',
      status,
      createdAt: invite.createdAt,
      updatedAt: invite.updatedAt,
      detail: this.getInviteDetail(invite, status),
    };
  }

  private toPeopleRequestRow(
    request: PeopleJoinRequestRecord,
  ): PeopleAccessRowView {
    const raw = {
      id: request.id,
      userId: request.userId,
      organizationId: request.organizationId,
      message: request.message,
      status: request.status,
      rejectionReason: request.rejectionReason,
      reviewedAt: request.reviewedAt,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      user: request.user,
      organization: request.organization,
    };

    return {
      id: `request:${request.id}`,
      raw,
      source: 'request',
      sourceLabel: 'Request',
      name: request.user.name ?? request.user.email,
      email: request.user.email,
      organization: request.organization,
      role: null,
      roleName: 'Requested access',
      status: request.status,
      createdAt: request.createdAt,
      updatedAt: request.reviewedAt ?? request.updatedAt,
      detail:
        request.rejectionReason ||
        request.message ||
        (request.reviewedAt
          ? 'This access request has been reviewed.'
          : 'Awaiting organization review.'),
    };
  }

  private toPeopleRole(
    role:
      | {
          id: string;
          organizationId: string | null;
          systemKey?: string | null;
          name: string;
          isSystem: boolean;
        }
      | null,
  ): PeopleAccessRoleView | null {
    if (!role) return null;

    return {
      id: role.id,
      organizationId: role.organizationId,
      systemKey: role.systemKey ?? null,
      name: role.name,
      isSystem: role.isSystem,
    };
  }

  private resolvePeopleInviteStatus(
    invite: Pick<PeopleInviteRecord, 'expiresAt' | 'status'>,
    now: Date,
  ): OrganizationInviteStatus {
    if (
      invite.status === OrganizationInviteStatus.PENDING &&
      invite.expiresAt <= now
    ) {
      return OrganizationInviteStatus.EXPIRED;
    }

    return invite.status;
  }

  private getInviteDetail(
    invite: PeopleInviteRecord,
    status: OrganizationInviteStatus,
  ): string {
    if (invite.revocationReason) return invite.revocationReason;
    if (invite.lastSendFailureReason) return invite.lastSendFailureReason;
    if (status === OrganizationInviteStatus.REVOKED) {
      return 'This invitation was revoked.';
    }
    if (status === OrganizationInviteStatus.ACCEPTED) {
      return 'This invitation was accepted.';
    }
    if (status === OrganizationInviteStatus.EXPIRED) {
      return 'This invitation has expired.';
    }

    return 'Invitation is waiting for the recipient.';
  }

  private async resolveApplicableRoles(
    organizationId: string,
    actorUserId: string,
    roleIdsInput: string[],
  ): Promise<MemberRoleRecord[]> {
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
      throw new BadRequestException({
        message: 'One or more roles are invalid, inactive, or unavailable',
        details: {
          invalidRoleIds,
        },
      });
    }

    await this.assertRolesAssignableByActor(actorUserId, roles);

    return roles;
  }

  private async assertRolesAssignableByActor(
    actorUserId: string,
    roles: MemberRoleRecord[],
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
          'Organization Admins can assign only Manager, Employee, or custom organization roles.',
        details: {
          blockedRoleIds: blockedRoles.map((role) => role.id),
        },
      });
    }
  }

  private async assertActorCanManageTargetMember(
    actorUserId: string,
    currentRoles: MemberRoleRecord[],
  ): Promise<void> {
    if (
      currentRoles.length === 0 ||
      (await this.userHasSuperAdminRole(actorUserId))
    ) {
      return;
    }

    const protectedRoles = currentRoles.filter(
      (role) => !this.isAssignableByOrganizationAdmin(role),
    );

    if (protectedRoles.length > 0) {
      throw new ForbiddenException({
        message:
          'Only Super Admin can manage members with protected system roles.',
        details: {
          protectedRoleIds: protectedRoles.map((role) => role.id),
        },
      });
    }
  }

  private isAssignableByOrganizationAdmin(role: MemberRoleRecord): boolean {
    if (role.systemKey === ORGANIZATION_ROLE_KEYS.organizationAdmin) {
      return false;
    }

    if (role.systemKey) {
      return ORGANIZATION_ROLE_ASSIGNMENT_LIMITED_SYSTEM_KEYS.has(
        role.systemKey,
      );
    }

    return true;
  }

  private async filterVisibleMembershipsForActor(
    organizationId: string,
    actorUserId: string,
    memberships: MembershipRecord[],
  ): Promise<MembershipRecord[]> {
    const actorTier = await this.resolveActorMemberVisibilityTier(
      organizationId,
      actorUserId,
    );

    if (actorTier >= MEMBER_VISIBILITY_TIER.organizationAdmin) {
      return memberships;
    }

    if (actorTier < MEMBER_VISIBILITY_TIER.manager) {
      throw new ForbiddenException(
        'Only organization administrators and managers can view organization members.',
      );
    }

    return memberships.filter(
      (membership) =>
        membership.userId !== actorUserId &&
        this.getMemberVisibilityTierFromRoles(membership.roles) ===
          MEMBER_VISIBILITY_TIER.employee,
    );
  }

  private buildMemberWhere(
    organizationId: string,
    query: ListMembersQueryDto,
  ): Prisma.OrganizationMembershipWhereInput {
    const search = query.search?.trim();
    const statusFilter =
      query.status === 'active'
        ? [OrganizationMembershipStatus.ACTIVE]
        : query.status === 'suspended'
          ? [OrganizationMembershipStatus.SUSPENDED]
          : [
              OrganizationMembershipStatus.ACTIVE,
              OrganizationMembershipStatus.SUSPENDED,
            ];

    return {
      organizationId,
      status: {
        in: statusFilter,
      },
      ...(query.roleId
        ? {
            roles: {
              some: {
                roleId: query.roleId,
              },
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              {
                user: {
                  is: {
                    email: {
                      contains: search,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                },
              },
              {
                user: {
                  is: {
                    name: {
                      contains: search,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                },
              },
              {
                roles: {
                  some: {
                    role: {
                      is: {
                        name: {
                          contains: search,
                          mode: Prisma.QueryMode.insensitive,
                        },
                      },
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  private async canActorViewMembership(
    organizationId: string,
    actorUserId: string,
    membership: MembershipRecord,
  ): Promise<boolean> {
    const actorTier = await this.resolveActorMemberVisibilityTier(
      organizationId,
      actorUserId,
    );

    if (actorTier >= MEMBER_VISIBILITY_TIER.organizationAdmin) {
      return true;
    }

    return (
      actorTier >= MEMBER_VISIBILITY_TIER.manager &&
      membership.userId !== actorUserId &&
      this.getMemberVisibilityTierFromRoles(membership.roles) ===
        MEMBER_VISIBILITY_TIER.employee
    );
  }

  private async resolveActorMemberVisibilityTier(
    organizationId: string,
    actorUserId: string,
  ): Promise<MemberVisibilityTier> {
    if (await this.userHasSuperAdminRole(actorUserId)) {
      return MEMBER_VISIBILITY_TIER.platform;
    }

    const access = await this.accessControlService.resolveOrganizationAccess(
      actorUserId,
      organizationId,
    );

    if (!access) {
      return MEMBER_VISIBILITY_TIER.none;
    }

    if (
      access.roles.some((role) => role.scope === AccessScope.PLATFORM) ||
      access.permissions.includes(ORGANIZATION_PERMISSIONS.membersManage)
    ) {
      return MEMBER_VISIBILITY_TIER.organizationAdmin;
    }

    const actorMembership = await this.prisma.organizationMembership.findFirst({
      where: {
        organizationId,
        userId: actorUserId,
        status: OrganizationMembershipStatus.ACTIVE,
      },
      select: {
        roles: this.memberVisibilityRoleSelect(organizationId),
      },
    });

    return actorMembership
      ? this.getMemberVisibilityTierFromRoles(actorMembership.roles)
      : MEMBER_VISIBILITY_TIER.none;
  }

  private getMemberVisibilityTierFromRoles(
    roles: Array<{ role: MemberRoleRecord }>,
  ): MemberVisibilityTier {
    if (roles.length === 0) {
      return MEMBER_VISIBILITY_TIER.employee;
    }

    return roles.reduce<MemberVisibilityTier>(
      (highestTier, { role }) =>
        Math.max(
          highestTier,
          this.getMemberVisibilityTierFromRole(role),
        ) as MemberVisibilityTier,
      MEMBER_VISIBILITY_TIER.none,
    );
  }

  private getMemberVisibilityTierFromRole(
    role: MemberRoleRecord,
  ): MemberVisibilityTier {
    if (role.systemKey === ORGANIZATION_ROLE_KEYS.organizationAdmin) {
      return MEMBER_VISIBILITY_TIER.organizationAdmin;
    }

    if (role.systemKey === ORGANIZATION_ROLE_KEYS.manager) {
      return MEMBER_VISIBILITY_TIER.manager;
    }

    if (role.systemKey === ORGANIZATION_ROLE_KEYS.employee) {
      return MEMBER_VISIBILITY_TIER.employee;
    }

    const permissionCodes = new Set(
      role.permissions.map(({ permission }) => permission.code),
    );

    if (
      permissionCodes.has(ORGANIZATION_PERMISSIONS.membersManage) ||
      permissionCodes.has(ORGANIZATION_PERMISSIONS.rolesManage) ||
      permissionCodes.has(ORGANIZATION_PERMISSIONS.permissionsAssign) ||
      permissionCodes.has(ORGANIZATION_PERMISSIONS.documentsDelete)
    ) {
      return MEMBER_VISIBILITY_TIER.organizationAdmin;
    }

    if (permissionCodes.has(ORGANIZATION_PERMISSIONS.analyticsView)) {
      return MEMBER_VISIBILITY_TIER.manager;
    }

    if (
      permissionCodes.has(ORGANIZATION_PERMISSIONS.documentsRead) ||
      permissionCodes.has(ORGANIZATION_PERMISSIONS.documentsCreate) ||
      permissionCodes.has(ORGANIZATION_PERMISSIONS.documentsUpdate) ||
      permissionCodes.has(ORGANIZATION_PERMISSIONS.documentsUpload) ||
      permissionCodes.has(ORGANIZATION_PERMISSIONS.aiAccess)
    ) {
      return MEMBER_VISIBILITY_TIER.employee;
    }

    return MEMBER_VISIBILITY_TIER.none;
  }

  private memberVisibilityRoleSelect(organizationId: string) {
    return {
      where: {
        role: {
          is: {
            scope: AccessScope.ORGANIZATION,
            isActive: true,
            OR: [{ organizationId: null }, { organizationId }],
          },
        },
      },
      select: {
        role: {
          select: {
            id: true,
            organizationId: true,
            systemKey: true,
            name: true,
            isSystem: true,
            permissions: {
              where: {
                permission: {
                  is: {
                    scope: AccessScope.ORGANIZATION,
                    isActive: true,
                  },
                },
              },
              select: {
                permission: {
                  select: {
                    code: true,
                  },
                },
              },
            },
          },
        },
      },
    };
  }

  private async ensureAnotherUserManager(
    transaction: Prisma.TransactionClient,
    organizationId: string,
    excludedMembershipId: string,
  ): Promise<void> {
    const anotherManager = await transaction.organizationMembership.findFirst({
      where: {
        id: { not: excludedMembershipId },
        organizationId,
        status: OrganizationMembershipStatus.ACTIVE,
        user: {
          is: {
            isVerified: true,
            isActive: true,
          },
        },
        roles: {
          some: {
            role: {
              is: {
                scope: AccessScope.ORGANIZATION,
                isActive: true,
                OR: [{ organizationId: null }, { organizationId }],
                permissions: {
                  some: {
                    permission: {
                      is: {
                        code: MEMBER_MANAGEMENT_PERMISSION,
                        scope: AccessScope.ORGANIZATION,
                        isActive: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      select: { id: true },
    });

    if (!anotherManager) {
      throw new ConflictException(
        'Organization must retain at least one active member with member management permission',
      );
    }
  }

  private async runSerializableMembershipMutation(
    operation: (transaction: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error: unknown) {
      if (isRetryableTransactionError(error)) {
        throw new ConflictException(
          'Organization membership changed concurrently; retry the request',
        );
      }

      throw error;
    }
  }

  private rolesGrantUserManagement(roles: MemberRoleRecord[]): boolean {
    return roles.some((role) =>
      role.permissions.some(
        ({ permission }) => permission.code === MEMBER_MANAGEMENT_PERMISSION,
      ),
    );
  }

  private async userHasSuperAdminRole(userId: string): Promise<boolean> {
    return this.envSuperAdminService.isConfiguredUserId(userId);
  }

  private async assertUserCanReceiveOrganizationRole(
    userId: string,
    currentMembershipId?: string,
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
          ...(currentMembershipId ? { id: { not: currentMembershipId } } : {}),
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

  private async requireCurrentMembership(
    organizationId: string,
    membershipId: string,
  ): Promise<MembershipRecord> {
    const membership = await this.findCurrentMembership(
      organizationId,
      membershipId,
    );

    if (!membership) {
      throw new NotFoundException('Organization member not found');
    }

    return membership;
  }

  private findCurrentMembership(
    organizationId: string,
    membershipId: string,
  ): Promise<MembershipRecord | null> {
    return this.prisma.organizationMembership.findFirst({
      where: {
        id: membershipId,
        organizationId,
        status: {
          in: [
            OrganizationMembershipStatus.ACTIVE,
            OrganizationMembershipStatus.SUSPENDED,
          ],
        },
      },
      select: this.membershipSelect(organizationId),
    });
  }

  private membershipSelect(organizationId: string) {
    return {
      id: true,
      organizationId: true,
      userId: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          isVerified: true,
          isActive: true,
        },
      },
      roles: {
        where: {
          role: {
            is: {
              scope: AccessScope.ORGANIZATION,
              isActive: true,
              OR: [{ organizationId: null }, { organizationId }],
            },
          },
        },
        select: {
          role: {
            select: {
              id: true,
              organizationId: true,
              systemKey: true,
              name: true,
              isSystem: true,
              permissions: {
                where: {
                  permission: {
                    is: {
                      scope: AccessScope.ORGANIZATION,
                      isActive: true,
                    },
                  },
                },
                select: {
                  permission: {
                    select: {
                      code: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    } as const satisfies Prisma.OrganizationMembershipSelect;
  }

  private toMemberView(membership: MembershipRecord): OrganizationMemberView {
    return {
      id: membership.id,
      organizationId: membership.organizationId,
      status: membership.status,
      user: membership.user,
      roles: membership.roles
        .map(({ role }) => ({
          id: role.id,
          organizationId: role.organizationId,
          systemKey: role.systemKey,
          name: role.name,
          isSystem: role.isSystem,
        }))
        .sort(
          (left, right) =>
            left.name.localeCompare(right.name) ||
            left.id.localeCompare(right.id),
        ),
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
    };
  }
}
