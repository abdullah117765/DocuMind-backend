import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from 'bcrypt';
import {
  AccessScope,
  Prisma,
  RoleAssignmentSource,
} from '../../generated/prisma/client';
import { normalizeEmail } from '../../common/validation/email.validation';
import { AccessControlService } from '../access-control/access-control.service';
import {
  SESSION_REVOCATION_REASONS,
  SessionService,
} from '../auth/session.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateManagedUserDto } from './dto/create-managed-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { ReplacePlatformRolesDto } from './dto/replace-platform-roles.dto';
import { UpdateManagedUserDto } from './dto/update-managed-user.dto';

const PASSWORD_HASH_ROUNDS = 12;

const managedUserSelect = {
  id: true,
  email: true,
  isVerified: true,
  isActive: true,
  deactivatedAt: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      sessions: true,
      organizationMemberships: true,
    },
  },
  platformRoleAssignments: {
    select: {
      role: {
        select: {
          id: true,
          name: true,
          systemKey: true,
          scope: true,
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
      },
      source: true,
      assignedAt: true,
    },
    orderBy: {
      role: {
        name: 'asc',
      },
    },
  },
  organizationMemberships: {
    select: {
      id: true,
      status: true,
      organization: {
        select: {
          id: true,
          name: true,
          slug: true,
        },
      },
      roles: {
        select: {
          role: {
            select: {
              id: true,
              name: true,
              systemKey: true,
              isSystem: true,
            },
          },
        },
        orderBy: {
          role: {
            name: 'asc',
          },
        },
      },
    },
    orderBy: {
      organization: {
        name: 'asc',
      },
    },
  },
} as const satisfies Prisma.UserSelect;

type ManagedUserRecord = Prisma.UserGetPayload<{
  select: typeof managedUserSelect;
}>;

export interface ManagedUserView {
  id: string;
  email: string;
  isVerified: boolean;
  isActive: boolean;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sessionCount: number;
  organizationMembershipCount: number;
  platformRoles: Array<{
    id: string;
    name: string;
    systemKey: string | null;
    isSystem: boolean;
    permissionCodes: string[];
  }>;
  memberships: Array<{
    id: string;
    status: string;
    organization: {
      id: string;
      name: string;
      slug: string;
    };
    roles: Array<{
      id: string;
      name: string;
      systemKey: string | null;
      isSystem: boolean;
    }>;
  }>;
}

export interface ManagedUserListResult {
  users: ManagedUserView[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}

export interface PlatformRoleView {
  id: string;
  name: string;
  systemKey: string | null;
  isSystem: boolean;
  permissionCodes: string[];
}

function toNormalizedEmail(email: string): string {
  return normalizeEmail(email) as string;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class UserManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
    private readonly accessControlService: AccessControlService,
  ) {}

  async listUsers(query: ListUsersQueryDto): Promise<ManagedUserListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = this.buildUserWhere(query);
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: managedUserSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      users: users.map((user) => this.toUserView(user)),
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(Math.ceil(total / pageSize), 1),
      },
    };
  }

  async getUser(userId: string): Promise<ManagedUserView> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: managedUserSelect,
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return this.toUserView(user);
  }

  async listPlatformRoles(): Promise<PlatformRoleView[]> {
    const roles = await this.prisma.role.findMany({
      where: {
        organizationId: null,
        scope: AccessScope.PLATFORM,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        systemKey: true,
        isSystem: true,
        permissions: {
          where: {
            permission: {
              is: {
                scope: AccessScope.PLATFORM,
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
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    return roles.map((role) => ({
      id: role.id,
      name: role.name,
      systemKey: role.systemKey,
      isSystem: role.isSystem,
      permissionCodes: role.permissions
        .map(({ permission }) => permission.code)
        .sort((left, right) => left.localeCompare(right)),
    }));
  }

  async createUser(dto: CreateManagedUserDto): Promise<ManagedUserView> {
    const email = toNormalizedEmail(dto.email);
    const passwordHash = await hash(dto.password, PASSWORD_HASH_ROUNDS);

    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          isVerified: dto.isVerified ?? true,
          isActive: true,
        },
        select: {
          id: true,
        },
      });

      return this.getUser(user.id);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Email is already registered');
      }

      throw error;
    }
  }

  async updateUser(
    actorUserId: string,
    userId: string,
    dto: UpdateManagedUserDto,
  ): Promise<ManagedUserView> {
    if (actorUserId === userId && dto.isActive === false) {
      throw new ForbiddenException('You cannot deactivate your own account.');
    }

    const existingUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true },
    });

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    const nextIsActive = dto.isActive ?? existingUser.isActive;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.isVerified === undefined ? {} : { isVerified: dto.isVerified }),
        ...(dto.isActive === undefined
          ? {}
          : {
              isActive: dto.isActive,
              deactivatedAt: dto.isActive ? null : new Date(),
            }),
      },
    });

    if (!nextIsActive && existingUser.isActive) {
      await this.sessionService.revokeAllUserSessions(
        userId,
        SESSION_REVOCATION_REASONS.accountUnavailable,
      );
    }

    await this.accessControlService.invalidateUserAccess(userId);

    return this.getUser(userId);
  }

  async replacePlatformRoles(
    actorUserId: string,
    userId: string,
    dto: ReplacePlatformRolesDto,
  ): Promise<ManagedUserView> {
    if (actorUserId === userId) {
      throw new ForbiddenException('You cannot change your own platform roles.');
    }

    const roleIds = [...new Set(dto.roleIds)].sort((left, right) =>
      left.localeCompare(right),
    );
    const [user, roles] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      }),
      this.prisma.role.findMany({
        where: {
          id: { in: roleIds },
          organizationId: null,
          scope: AccessScope.PLATFORM,
          isActive: true,
        },
        select: { id: true },
      }),
    ]);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const validRoleIds = new Set(roles.map((role) => role.id));
    const invalidRoleIds = roleIds.filter((roleId) => !validRoleIds.has(roleId));

    if (invalidRoleIds.length > 0) {
      throw new ConflictException({
        message: 'One or more platform roles are invalid or inactive',
        details: { invalidRoleIds },
      });
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.platformUserRole.deleteMany({
        where: { userId },
      });

      if (roleIds.length > 0) {
        await transaction.platformUserRole.createMany({
          data: roleIds.map((roleId) => ({
            userId,
            roleId,
            assignedByUserId: actorUserId,
            source: RoleAssignmentSource.ADMIN,
          })),
        });
      }
    });

    await this.accessControlService.invalidateUserAccess(userId);

    return this.getUser(userId);
  }

  private buildUserWhere(query: ListUsersQueryDto): Prisma.UserWhereInput {
    const search = query.search?.trim();

    return {
      ...(query.status && query.status !== 'all'
        ? { isActive: query.status === 'active' }
        : {}),
      ...(query.verified === undefined ? {} : { isVerified: query.verified }),
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
                organizationMemberships: {
                  some: {
                    organization: {
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

  private toUserView(user: ManagedUserRecord): ManagedUserView {
    return {
      id: user.id,
      email: user.email,
      isVerified: user.isVerified,
      isActive: user.isActive,
      deactivatedAt: user.deactivatedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      sessionCount: user._count.sessions,
      organizationMembershipCount: user._count.organizationMemberships,
      platformRoles: user.platformRoleAssignments.map(({ role }) => ({
        id: role.id,
        name: role.name,
        systemKey: role.systemKey,
        isSystem: role.isSystem,
        permissionCodes: role.permissions
          .map(({ permission }) => permission.code)
          .sort((left, right) => left.localeCompare(right)),
      })),
      memberships: user.organizationMemberships.map((membership) => ({
        id: membership.id,
        status: membership.status,
        organization: membership.organization,
        roles: membership.roles.map(({ role }) => ({
          id: role.id,
          name: role.name,
          systemKey: role.systemKey,
          isSystem: role.isSystem,
        })),
      })),
    };
  }
}
