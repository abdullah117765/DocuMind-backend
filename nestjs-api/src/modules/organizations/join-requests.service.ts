import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessScope,
  JoinRequestStatus,
  OrganizationMembershipStatus,
  Prisma,
} from '../../generated/prisma/client';
import { AccessControlService } from '../access-control/access-control.service';
import {
  ORGANIZATION_ROLE_ASSIGNMENT_LIMITED_SYSTEM_KEYS,
  ORGANIZATION_ROLE_ASSIGNMENT_PROTECTED_PERMISSIONS,
  ORGANIZATION_ROLE_KEYS,
  PLATFORM_ROLE_KEYS,
} from '../access-control/rbac.constants';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import { PrismaService } from '../prisma/prisma.service';
import { AcceptJoinRequestDto } from './dto/accept-join-request.dto';
import { CreateJoinRequestDto } from './dto/create-join-request.dto';
import { RejectJoinRequestDto } from './dto/reject-join-request.dto';
import { DEFAULT_ORGANIZATION_LIMITS } from './organization-defaults';

const JOIN_REQUEST_RETRY_COOLDOWN_HOURS = 24;
const EMPLOYEE_SYSTEM_KEY = 'employee';

interface AssignableJoinRequestRoleRecord {
  id: string;
  systemKey: string | null;
  permissions: Array<{
    permission: {
      code: string;
    };
  }>;
}

const joinRequestSelect = {
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
  reviewedBy: {
    select: {
      id: true,
      email: true,
    },
  },
} as const satisfies Prisma.JoinRequestSelect;

type JoinRequestRecord = Prisma.JoinRequestGetPayload<{
  select: typeof joinRequestSelect;
}>;

export interface JoinRequestView {
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
    email: string;
    isVerified: boolean;
    isActive: boolean;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  reviewedBy: {
    id: string;
    email: string;
  } | null;
}

export interface DiscoverOrganizationView {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  existingRequest: {
    id: string;
    status: JoinRequestStatus;
    rejectionReason: string | null;
    createdAt: Date;
  } | null;
}

function normalizeRoleIds(roleIds: string[] = []): string[] {
  return [...new Set(roleIds)].sort((left, right) => left.localeCompare(right));
}

@Injectable()
export class JoinRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
  ) {}

  async discoverOrganizations(
    userId: string,
  ): Promise<DiscoverOrganizationView[]> {
    if (await this.userHasSuperAdminRole(userId)) {
      return [];
    }

    const [memberships, organizations, requests] = await Promise.all([
      this.prisma.organizationMembership.findMany({
        where: {
          userId,
          status: {
            in: [
              OrganizationMembershipStatus.ACTIVE,
              OrganizationMembershipStatus.SUSPENDED,
            ],
          },
        },
        select: { organizationId: true },
      }),
      this.prisma.organization.findMany({
        where: { allowJoinRequests: true },
        select: {
          id: true,
          name: true,
          slug: true,
          _count: {
            select: {
              memberships: true,
            },
          },
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.joinRequest.findMany({
        where: { userId },
        select: {
          id: true,
          organizationId: true,
          status: true,
          rejectionReason: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
    ]);
    const memberOrganizationIds = new Set(
      memberships.map((membership) => membership.organizationId),
    );
    const latestRequestByOrganizationId = new Map<
      string,
      (typeof requests)[number]
    >();

    for (const request of requests) {
      if (!latestRequestByOrganizationId.has(request.organizationId)) {
        latestRequestByOrganizationId.set(request.organizationId, request);
      }
    }

    return organizations
      .filter((organization) => !memberOrganizationIds.has(organization.id))
      .map((organization) => {
        const existingRequest = latestRequestByOrganizationId.get(
          organization.id,
        );

        return {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          memberCount: organization._count.memberships,
          existingRequest: existingRequest
            ? {
                id: existingRequest.id,
                status: existingRequest.status,
                rejectionReason: existingRequest.rejectionReason,
                createdAt: existingRequest.createdAt,
              }
            : null,
        };
      });
  }

  async listMyRequests(userId: string): Promise<JoinRequestView[]> {
    const requests = await this.prisma.joinRequest.findMany({
      where: { userId },
      select: joinRequestSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });

    return requests.map((request) => this.toView(request));
  }

  async createJoinRequest(
    organizationId: string,
    principal: AuthenticatedPrincipal,
    dto: CreateJoinRequestDto,
    now = new Date(),
  ): Promise<JoinRequestView> {
    if (!principal.isVerified) {
      throw new ForbiddenException('Verify your email before requesting access.');
    }

    if (await this.userHasSuperAdminRole(principal.userId)) {
      throw new ForbiddenException({
        message:
          'Super Admin accounts already have platform-level organization access and cannot request tenant membership.',
        details: {
          reason: 'PLATFORM_ADMIN_CANNOT_REQUEST_ORGANIZATION_MEMBERSHIP',
        },
      });
    }

    const [organization, membership, latestRequest] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, allowJoinRequests: true },
      }),
      this.prisma.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId,
            userId: principal.userId,
          },
        },
        select: { status: true },
      }),
      this.prisma.joinRequest.findFirst({
        where: {
          organizationId,
          userId: principal.userId,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        select: {
          status: true,
          createdAt: true,
        },
      }),
    ]);

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    if (!organization.allowJoinRequests) {
      throw new ForbiddenException(
        'This organization is not accepting join requests.',
      );
    }

    if (
      membership &&
      membership.status !== OrganizationMembershipStatus.REMOVED
    ) {
      throw new ConflictException('You are already a member of this organization.');
    }

    if (latestRequest?.status === JoinRequestStatus.PENDING) {
      throw new ConflictException('You already have a pending join request.');
    }

    if (latestRequest?.status === JoinRequestStatus.ACCEPTED) {
      throw new ConflictException(
        'A previous request for this organization was already accepted.',
      );
    }

    if (
      latestRequest?.status === JoinRequestStatus.REJECTED &&
      now.getTime() - latestRequest.createdAt.getTime() <
        JOIN_REQUEST_RETRY_COOLDOWN_HOURS * 60 * 60 * 1000
    ) {
      throw new GoneException({
        message:
          'Please wait 24 hours before requesting access to this organization again.',
        details: { reason: 'JOIN_REQUEST_COOLDOWN' },
      });
    }

    const request = await this.prisma.joinRequest.create({
      data: {
        organizationId,
        userId: principal.userId,
        message: dto.message,
      },
      select: joinRequestSelect,
    });

    return this.toView(request);
  }

  async cancelMyRequest(userId: string, requestId: string): Promise<void> {
    const canceled = await this.prisma.joinRequest.updateMany({
      where: {
        id: requestId,
        userId,
        status: JoinRequestStatus.PENDING,
      },
      data: {
        status: JoinRequestStatus.CANCELED,
      },
    });

    if (canceled.count !== 1) {
      throw new NotFoundException('Pending join request not found');
    }
  }

  async listOrganizationRequests(
    organizationId: string,
    status?: JoinRequestStatus,
  ): Promise<JoinRequestView[]> {
    const requests = await this.prisma.joinRequest.findMany({
      where: {
        organizationId,
        ...(status ? { status } : {}),
      },
      select: joinRequestSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });

    return requests.map((request) => this.toView(request));
  }

  async acceptRequest(
    organizationId: string,
    requestId: string,
    actorUserId: string,
    dto: AcceptJoinRequestDto,
    now = new Date(),
  ): Promise<JoinRequestView> {
    const request = await this.prisma.joinRequest.findUnique({
      where: { id: requestId },
      select: joinRequestSelect,
    });

    if (!request || request.organizationId !== organizationId) {
      throw new NotFoundException('Join request not found');
    }

    if (request.status !== JoinRequestStatus.PENDING) {
      throw new ConflictException('Only pending join requests can be accepted.');
    }

    if (request.userId === actorUserId) {
      throw new ForbiddenException('You cannot approve your own join request.');
    }

    if (!request.user.isActive || !request.user.isVerified) {
      throw new ConflictException(
        'The requester must have an active verified account.',
      );
    }

    if (await this.userHasSuperAdminRole(request.userId)) {
      throw new ConflictException({
        message:
          'Super Admin accounts manage organizations from the platform level and cannot become organization members.',
        details: {
          reason: 'PLATFORM_ADMIN_CANNOT_JOIN_ORGANIZATION',
        },
      });
    }

    const roles = await this.resolveRoles(
      organizationId,
      dto.roleIds ?? [],
      actorUserId,
    );
    const acceptedRequest = await this.prisma.$transaction(
      async (transaction) => {
        const existingMembership =
          await transaction.organizationMembership.findUnique({
            where: {
              organizationId_userId: {
                organizationId,
                userId: request.userId,
              },
            },
            select: { id: true, status: true },
          });

        if (
          !existingMembership ||
          existingMembership.status === OrganizationMembershipStatus.REMOVED
        ) {
          const [limits, memberCount] = await Promise.all([
            transaction.organizationLimit.findUnique({
              where: { organizationId },
              select: { maxMembers: true },
            }),
            transaction.organizationMembership.count({
              where: {
                organizationId,
                status: {
                  in: [
                    OrganizationMembershipStatus.ACTIVE,
                    OrganizationMembershipStatus.SUSPENDED,
                  ],
                },
              },
            }),
          ]);
          const maxMembers =
            limits?.maxMembers ?? DEFAULT_ORGANIZATION_LIMITS.maxMembers;

          if (memberCount + 1 > maxMembers) {
            throw new ConflictException(
              'Organization member limit reached. Increase the limit before accepting this request.',
            );
          }
        }

        const claimed = await transaction.joinRequest.updateMany({
          where: {
            id: requestId,
            organizationId,
            status: JoinRequestStatus.PENDING,
          },
          data: {
            status: JoinRequestStatus.ACCEPTED,
            reviewedByUserId: actorUserId,
            reviewedAt: now,
          },
        });

        if (claimed.count !== 1) {
          throw new ConflictException('This join request is no longer pending.');
        }

        const membership = existingMembership
          ? await transaction.organizationMembership.update({
              where: { id: existingMembership.id },
              data: { status: OrganizationMembershipStatus.ACTIVE },
              select: { id: true },
            })
          : await transaction.organizationMembership.create({
              data: {
                organizationId,
                userId: request.userId,
                status: OrganizationMembershipStatus.ACTIVE,
              },
              select: { id: true },
            });

        await transaction.membershipRole.deleteMany({
          where: { membershipId: membership.id },
        });

        if (roles.length > 0) {
          await transaction.membershipRole.createMany({
            data: roles.map((role) => ({
              membershipId: membership.id,
              roleId: role.id,
              assignedByUserId: actorUserId,
            })),
          });
        }

        return transaction.joinRequest.findUniqueOrThrow({
          where: { id: requestId },
          select: joinRequestSelect,
        });
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    await this.accessControlService.invalidateUserAccess(request.userId);
    await this.accessControlService.invalidateOrganizationAccess(organizationId);

    return this.toView(acceptedRequest);
  }

  async rejectRequest(
    organizationId: string,
    requestId: string,
    actorUserId: string,
    dto: RejectJoinRequestDto,
    now = new Date(),
  ): Promise<JoinRequestView> {
    const request = await this.prisma.joinRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        organizationId: true,
        userId: true,
        status: true,
      },
    });

    if (!request || request.organizationId !== organizationId) {
      throw new NotFoundException('Join request not found');
    }

    if (request.status !== JoinRequestStatus.PENDING) {
      throw new ConflictException('Only pending join requests can be rejected.');
    }

    if (request.userId === actorUserId) {
      throw new ForbiddenException('You cannot reject your own join request.');
    }

    await this.prisma.joinRequest.update({
      where: { id: requestId },
      data: {
        status: JoinRequestStatus.REJECTED,
        reviewedByUserId: actorUserId,
        reviewedAt: now,
        rejectionReason: dto.rejectionReason,
      },
    });

    return this.getRequest(requestId);
  }

  private async getRequest(requestId: string): Promise<JoinRequestView> {
    const request = await this.prisma.joinRequest.findUnique({
      where: { id: requestId },
      select: joinRequestSelect,
    });

    if (!request) {
      throw new NotFoundException('Join request not found');
    }

    return this.toView(request);
  }

  private async resolveRoles(
    organizationId: string,
    roleIdsInput: string[],
    actorUserId?: string,
  ): Promise<AssignableJoinRequestRoleRecord[]> {
    const roleIds = normalizeRoleIds(roleIdsInput);

    if (roleIds.length === 0) {
      const employeeRole = await this.prisma.role.findFirst({
        where: {
          systemKey: EMPLOYEE_SYSTEM_KEY,
          scope: AccessScope.ORGANIZATION,
          isActive: true,
        },
        select: {
          id: true,
          systemKey: true,
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

      if (!employeeRole) {
        throw new ConflictException('Default employee role is not configured.');
      }

      return [employeeRole];
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
        systemKey: true,
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

    if (actorUserId) {
      await this.assertRolesAssignableByActor(actorUserId, roles);
    }

    return roles;
  }

  private async assertRolesAssignableByActor(
    actorUserId: string,
    roles: AssignableJoinRequestRoleRecord[],
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
          'Organization Admins can accept join requests only as Manager, Employee, Viewer, or non-admin custom roles.',
        details: {
          blockedRoleIds: blockedRoles.map((role) => role.id),
        },
      });
    }
  }

  private isAssignableByOrganizationAdmin(
    role: AssignableJoinRequestRoleRecord,
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

  private toView(request: JoinRequestRecord): JoinRequestView {
    return {
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
      reviewedBy: request.reviewedBy,
    };
  }

  private async userHasSuperAdminRole(userId: string): Promise<boolean> {
    const assignment = await this.prisma.platformUserRole.findFirst({
      where: {
        userId,
        role: {
          is: {
            systemKey: PLATFORM_ROLE_KEYS.superAdmin,
            scope: AccessScope.PLATFORM,
            isActive: true,
          },
        },
      },
      select: { roleId: true },
    });

    return Boolean(assignment);
  }
}
