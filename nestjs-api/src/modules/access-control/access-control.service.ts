import { Injectable } from '@nestjs/common';
import {
  AccessScope,
  OrganizationMembershipStatus,
  OrganizationStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EnvSuperAdminService } from '../auth/env-super-admin.service';
import { AccessControlCacheService } from './access-control-cache.service';
import {
  EffectiveRole,
  OrganizationAccess,
  PlatformAccess,
} from './access-control.types';
import { PLATFORM_ROLE_KEYS } from './rbac.constants';

interface ResolvedRole {
  id: string;
  name: string;
  scope: AccessScope;
  permissions: Array<{
    permission: {
      code: string;
    };
  }>;
}

function buildEffectiveAccess(roles: ResolvedRole[]): {
  roles: EffectiveRole[];
  permissions: string[];
} {
  const uniqueRoles = new Map<string, EffectiveRole>();
  const uniquePermissions = new Set<string>();

  for (const role of roles) {
    uniqueRoles.set(role.id, {
      id: role.id,
      name: role.name,
      scope: role.scope,
    });

    for (const { permission } of role.permissions) {
      uniquePermissions.add(permission.code);
    }
  }

  return {
    roles: [...uniqueRoles.values()].sort(
      (left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    ),
    permissions: [...uniquePermissions].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

@Injectable()
export class AccessControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: AccessControlCacheService,
    private readonly envSuperAdminService: EnvSuperAdminService,
  ) {}

  async resolvePlatformAccess(userId: string): Promise<PlatformAccess> {
    if (await this.envSuperAdminService.isConfiguredUserId(userId)) {
      return this.resolveEnvSuperAdminPlatformAccess(userId);
    }

    const cachedAccess = await this.cache.getPlatformAccess(userId);

    if (cachedAccess.value) {
      return cachedAccess.value;
    }

    const assignments = await this.prisma.platformUserRole.findMany({
      where: {
        userId,
        role: {
          is: {
            organizationId: null,
            scope: AccessScope.PLATFORM,
            isActive: true,
            OR: [
              { systemKey: null },
              { systemKey: { not: PLATFORM_ROLE_KEYS.superAdmin } },
            ],
          },
        },
      },
      select: {
        role: {
          select: {
            id: true,
            name: true,
            scope: true,
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
        },
      },
    });
    const effectiveAccess = buildEffectiveAccess(
      assignments.map(({ role }) => role),
    );
    const result: PlatformAccess = {
      userId,
      ...effectiveAccess,
    };

    await this.cache.setPlatformAccess(userId, cachedAccess.stamp, result);

    return result;
  }

  async resolveOrganizationAccess(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationAccess | null> {
    const cachedAccess = await this.cache.getOrganizationAccess(
      userId,
      organizationId,
    );

    if (cachedAccess.value) {
      return cachedAccess.value;
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, status: true },
    });

    if (!organization || organization.status !== OrganizationStatus.ACTIVE) {
      return null;
    }

    if (await this.envSuperAdminService.isConfiguredUserId(userId)) {
      const result = await this.buildEnvSuperAdminOrganizationAccess(
        userId,
        organizationId,
      );

      await this.cache.setOrganizationAccess(
        userId,
        organizationId,
        cachedAccess.stamp,
        result,
      );

      return result;
    }

    const [platformAssignments, membership] = await Promise.all([
      this.prisma.platformUserRole.findMany({
        where: {
          userId,
          role: {
            is: {
              organizationId: null,
              scope: AccessScope.PLATFORM,
              isActive: true,
              OR: [
                { systemKey: null },
                { systemKey: { not: PLATFORM_ROLE_KEYS.superAdmin } },
              ],
            },
          },
        },
        select: {
          role: {
            select: {
              id: true,
              name: true,
              scope: true,
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
      }),
      this.prisma.organizationMembership.findFirst({
        where: {
          organizationId,
          userId,
          status: OrganizationMembershipStatus.ACTIVE,
        },
        select: {
          id: true,
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
                  name: true,
                  scope: true,
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
        },
      }),
    ]);

    const effectiveAccess = buildEffectiveAccess([
      ...platformAssignments.map(({ role }) => role),
      ...(membership?.roles.map(({ role }) => role) ?? []),
    ]);
    const result: OrganizationAccess = {
      userId,
      organizationId,
      membershipId: membership?.id ?? null,
      ...effectiveAccess,
    };

    await this.cache.setOrganizationAccess(
      userId,
      organizationId,
      cachedAccess.stamp,
      result,
    );

    return result;
  }

  invalidateUserAccess(userId: string): Promise<void> {
    return this.cache.invalidateUser(userId);
  }

  invalidateOrganizationAccess(organizationId: string): Promise<void> {
    return this.cache.invalidateOrganization(organizationId);
  }

  invalidateRoleAccess(): Promise<void> {
    return this.cache.invalidateAll();
  }

  invalidatePermissionAccess(): Promise<void> {
    return this.cache.invalidateAll();
  }

  invalidateAllAccess(): Promise<void> {
    return this.cache.invalidateAll();
  }

  private async resolveEnvSuperAdminPlatformAccess(
    userId: string,
  ): Promise<PlatformAccess> {
    const cachedAccess = await this.cache.getPlatformAccess(userId);

    if (cachedAccess.value) {
      return cachedAccess.value;
    }

    const role = this.envSuperAdminService.getVirtualRole();
    const result: PlatformAccess = {
      userId,
      roles: role ? [role] : [],
      permissions: await this.envSuperAdminService.listActivePermissionCodes(
        AccessScope.PLATFORM,
      ),
    };

    await this.cache.setPlatformAccess(userId, cachedAccess.stamp, result);

    return result;
  }

  private async buildEnvSuperAdminOrganizationAccess(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationAccess> {
    const role = this.envSuperAdminService.getVirtualRole();

    return {
      userId,
      organizationId,
      membershipId: null,
      roles: role ? [role] : [],
      permissions: await this.envSuperAdminService.listActivePermissionCodes(
        AccessScope.ORGANIZATION,
      ),
    };
  }
}
