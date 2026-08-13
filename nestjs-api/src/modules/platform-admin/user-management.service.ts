import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from 'bcrypt';
import {
  AccessScope,
  OrganizationMembershipStatus,
  Prisma,
} from '../../generated/prisma/client';
import { normalizeEmail } from '../../common/validation/email.validation';
import { AccessControlService } from '../access-control/access-control.service';
import { EnvSuperAdminService } from '../auth/env-super-admin.service';
import {
  SESSION_REVOCATION_REASONS,
  SessionService,
} from '../auth/session.service';
import { PrismaService } from '../prisma/prisma.service';
import { PLATFORM_ROLE_KEYS } from '../access-control/rbac.constants';
import { CreateManagedUserDto } from './dto/create-managed-user.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UpdateManagedUserDto } from './dto/update-managed-user.dto';

const PASSWORD_HASH_ROUNDS = 12;

const managedUserSelect = {
  id: true,
  name: true,
  email: true,
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
    where: {
      role: {
        is: {
          NOT: {
            systemKey: PLATFORM_ROLE_KEYS.superAdmin,
          },
        },
      },
    },
    select: {
      role: {
        select: {
          id: true,
          name: true,
          systemKey: true,
          scope: true,
          isSystem: true,
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
    where: {
      status: {
        not: OrganizationMembershipStatus.REMOVED,
      },
    },
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
  name: string | null;
  email: string;
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
    private readonly envSuperAdminService: EnvSuperAdminService,
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

    if (this.envSuperAdminService.isConfiguredUser(user)) {
      throw new NotFoundException('User not found');
    }

    return this.toUserView(user);
  }

  async createUser(dto: CreateManagedUserDto): Promise<ManagedUserView> {
    const email = toNormalizedEmail(dto.email);

    if (this.envSuperAdminService.isConfiguredEmail(email)) {
      throw new ConflictException(
        'Super Admin account is managed through environment variables.',
      );
    }

    const passwordHash = await hash(dto.password, PASSWORD_HASH_ROUNDS);

    try {
      const user = await this.prisma.user.create({
        data: {
          name: dto.name,
          email,
          passwordHash,
          isVerified: true,
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
      select: {
        id: true,
        email: true,
        isActive: true,
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

    if (!existingUser) {
      throw new NotFoundException('User not found');
    }

    const nextIsActive = dto.isActive ?? existingUser.isActive;

    if (
      (this.envSuperAdminService.isConfiguredUser(existingUser) ||
        existingUser.platformRoleAssignments.length > 0) &&
      dto.isActive !== undefined
    ) {
      throw new ForbiddenException(
        'Super Admin accounts are protected and cannot be changed from user management.',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
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

  private buildUserWhere(query: ListUsersQueryDto): Prisma.UserWhereInput {
    const search = query.search?.trim();

    return {
      ...(query.status && query.status !== 'all'
        ? { isActive: query.status === 'active' }
        : {}),
      ...(this.envSuperAdminService.getConfiguredEmail()
        ? {
            email: {
              not: this.envSuperAdminService.getConfiguredEmail() as string,
            },
          }
        : {}),
      ...(query.organizationId
        ? {
            organizationMemberships: {
              some: {
                organizationId: query.organizationId,
                status: {
                  not: OrganizationMembershipStatus.REMOVED,
                },
              },
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              {
                name: {
                  contains: search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
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
              {
                organizationMemberships: {
                  some: {
                    status: {
                      not: OrganizationMembershipStatus.REMOVED,
                    },
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
                },
              },
              {
                platformRoleAssignments: {
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

  private toUserView(user: ManagedUserRecord): ManagedUserView {
    const superAdminRole = this.envSuperAdminService.isConfiguredUser(user)
      ? this.envSuperAdminService.getVirtualRole()
      : null;

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      isActive: user.isActive,
      deactivatedAt: user.deactivatedAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      sessionCount: user._count.sessions,
      organizationMembershipCount: user._count.organizationMemberships,
      platformRoles: superAdminRole
        ? [
            {
              id: superAdminRole.id,
              name: superAdminRole.name,
              systemKey: PLATFORM_ROLE_KEYS.superAdmin,
              isSystem: true,
            },
          ]
        : user.platformRoleAssignments.map(({ role }) => ({
            id: role.id,
            name: role.name,
            systemKey: role.systemKey,
            isSystem: role.isSystem,
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
