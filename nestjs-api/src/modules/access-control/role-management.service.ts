import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessScope,
  OrganizationMembershipStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccessControlService } from './access-control.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

interface PermissionRecord {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  scope: AccessScope;
}

interface RoleRecord {
  id: string;
  organizationId: string | null;
  name: string;
  description: string | null;
  scope: AccessScope;
  isSystem: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  permissions: Array<{
    permission: PermissionRecord;
  }>;
  _count: {
    membershipAssignments: number;
  };
}

const USER_MANAGEMENT_PERMISSION = 'users.manage';

export interface PermissionView {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string;
  scope: AccessScope;
}

export interface RoleView {
  id: string;
  organizationId: string | null;
  name: string;
  description: string | null;
  scope: AccessScope;
  isSystem: boolean;
  isActive: boolean;
  assignedMembersCount: number;
  permissions: PermissionView[];
  createdAt: Date;
  updatedAt: Date;
}

function cleanRoleName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function normalizeRoleName(name: string): string {
  return cleanRoleName(name).toLowerCase();
}

function normalizeDescription(
  description: string | null | undefined,
): string | null {
  return description?.trim() || null;
}

function normalizePermissionCodes(permissionCodes: string[]): string[] {
  return [
    ...new Set(permissionCodes.map((permissionCode) => permissionCode.trim())),
  ].sort((left, right) => left.localeCompare(right));
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
export class RoleManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
  ) {}

  async listPermissions(): Promise<PermissionView[]> {
    return this.prisma.permission.findMany({
      where: {
        scope: AccessScope.ORGANIZATION,
        isActive: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        category: true,
        scope: true,
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }, { code: 'asc' }],
    });
  }

  async listRoles(organizationId: string): Promise<RoleView[]> {
    const roles = await this.prisma.role.findMany({
      where: {
        scope: AccessScope.ORGANIZATION,
        isActive: true,
        OR: [{ organizationId: null }, { organizationId }],
      },
      select: this.roleSelect(organizationId),
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    });

    return roles.map((role) => this.toRoleView(role));
  }

  async getRole(organizationId: string, roleId: string): Promise<RoleView> {
    const role = await this.findApplicableRole(organizationId, roleId);

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return this.toRoleView(role);
  }

  async createRole(
    organizationId: string,
    actorUserId: string,
    dto: CreateRoleDto,
  ): Promise<RoleView> {
    const permissionCodes = normalizePermissionCodes(dto.permissionCodes ?? []);
    const permissions = await this.resolvePermissions(permissionCodes);
    const name = cleanRoleName(dto.name);
    const normalizedName = normalizeRoleName(name);

    await this.ensureRoleNameAvailable(organizationId, normalizedName);

    let roleId: string;

    try {
      roleId = await this.prisma.$transaction(async (transaction) => {
        const role = await transaction.role.create({
          data: {
            organizationId,
            name,
            normalizedName,
            description: normalizeDescription(dto.description),
            scope: AccessScope.ORGANIZATION,
            isSystem: false,
            isActive: true,
            autoGrantNewPermissions: false,
          },
          select: { id: true },
        });

        if (permissions.length > 0) {
          await transaction.rolePermission.createMany({
            data: permissions.map((permission) => ({
              roleId: role.id,
              permissionId: permission.id,
              grantedByUserId: actorUserId,
            })),
          });
        }

        return role.id;
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          'A role with this name already exists in the organization',
        );
      }

      throw error;
    }

    await this.accessControlService.invalidateOrganizationAccess(
      organizationId,
    );

    return this.getRole(organizationId, roleId);
  }

  async updateRole(
    organizationId: string,
    roleId: string,
    dto: UpdateRoleDto,
  ): Promise<RoleView> {
    await this.requireMutableRole(organizationId, roleId);

    if (dto.name === undefined && dto.description === undefined) {
      throw new BadRequestException('At least one role field must be provided');
    }

    const updateData: Prisma.RoleUpdateInput = {};

    if (dto.name !== undefined) {
      const name = cleanRoleName(dto.name);
      const normalizedName = normalizeRoleName(name);

      await this.ensureRoleNameAvailable(
        organizationId,
        normalizedName,
        roleId,
      );
      updateData.name = name;
      updateData.normalizedName = normalizedName;
    }

    if (dto.description !== undefined) {
      updateData.description = normalizeDescription(dto.description);
    }

    try {
      await this.prisma.role.update({
        where: { id: roleId },
        data: updateData,
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          'A role with this name already exists in the organization',
        );
      }

      throw error;
    }

    await this.accessControlService.invalidateOrganizationAccess(
      organizationId,
    );

    return this.getRole(organizationId, roleId);
  }

  async replaceRolePermissions(
    organizationId: string,
    roleId: string,
    actorUserId: string,
    permissionCodesInput: string[],
  ): Promise<RoleView> {
    const role = await this.requireMutableRole(organizationId, roleId);

    const permissionCodes = normalizePermissionCodes(permissionCodesInput);
    const permissions = await this.resolvePermissions(permissionCodes);
    const revokesUserManagement =
      role.permissions.some(
        ({ permission }) => permission.code === USER_MANAGEMENT_PERMISSION,
      ) &&
      !permissions.some(
        (permission) => permission.code === USER_MANAGEMENT_PERMISSION,
      );

    await this.runSerializableRoleMutation(async (transaction) => {
      if (revokesUserManagement) {
        await this.ensureRoleCanLoseUserManagement(
          transaction,
          organizationId,
          roleId,
        );
      }

      await transaction.rolePermission.deleteMany({
        where: { roleId },
      });

      if (permissions.length > 0) {
        await transaction.rolePermission.createMany({
          data: permissions.map((permission) => ({
            roleId,
            permissionId: permission.id,
            grantedByUserId: actorUserId,
          })),
        });
      }
    });

    await this.accessControlService.invalidateOrganizationAccess(
      organizationId,
    );

    return this.getRole(organizationId, roleId);
  }

  async deleteRole(organizationId: string, roleId: string): Promise<void> {
    const role = await this.requireMutableRole(organizationId, roleId);
    const grantsUserManagement = role.permissions.some(
      ({ permission }) => permission.code === USER_MANAGEMENT_PERMISSION,
    );

    await this.runSerializableRoleMutation(async (transaction) => {
      if (grantsUserManagement) {
        await this.ensureRoleCanLoseUserManagement(
          transaction,
          organizationId,
          roleId,
        );
      }

      await transaction.membershipRole.deleteMany({
        where: { roleId },
      });
      await transaction.role.update({
        where: { id: roleId },
        data: {
          isActive: false,
          normalizedName: `deleted:${roleId}`,
        },
      });
    });

    await this.accessControlService.invalidateOrganizationAccess(
      organizationId,
    );
  }

  private async ensureRoleCanLoseUserManagement(
    transaction: Prisma.TransactionClient,
    organizationId: string,
    roleId: string,
  ): Promise<void> {
    const affectedMember = await transaction.organizationMembership.findFirst({
      where: {
        organizationId,
        status: OrganizationMembershipStatus.ACTIVE,
        user: {
          is: {
            isVerified: true,
          },
        },
        roles: {
          some: {
            roleId,
          },
        },
      },
      select: { id: true },
    });

    if (!affectedMember) {
      return;
    }

    const alternativeManager =
      await transaction.organizationMembership.findFirst({
        where: {
          organizationId,
          status: OrganizationMembershipStatus.ACTIVE,
          user: {
            is: {
              isVerified: true,
            },
          },
          roles: {
            some: {
              role: {
                is: {
                  id: { not: roleId },
                  scope: AccessScope.ORGANIZATION,
                  isActive: true,
                  OR: [{ organizationId: null }, { organizationId }],
                  permissions: {
                    some: {
                      permission: {
                        is: {
                          code: USER_MANAGEMENT_PERMISSION,
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

    if (!alternativeManager) {
      throw new ConflictException(
        'Organization must retain at least one active member with user management permission',
      );
    }
  }

  private async runSerializableRoleMutation(
    operation: (transaction: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error: unknown) {
      if (isRetryableTransactionError(error)) {
        throw new ConflictException(
          'Organization access changed concurrently; retry the request',
        );
      }

      throw error;
    }
  }

  private async resolvePermissions(
    permissionCodes: string[],
  ): Promise<Array<{ id: string; code: string }>> {
    if (permissionCodes.length === 0) {
      return [];
    }

    const permissions = await this.prisma.permission.findMany({
      where: {
        code: { in: permissionCodes },
        scope: AccessScope.ORGANIZATION,
        isActive: true,
      },
      select: {
        id: true,
        code: true,
      },
    });
    const resolvedCodes = new Set(
      permissions.map((permission) => permission.code),
    );
    const invalidPermissionCodes = permissionCodes.filter(
      (permissionCode) => !resolvedCodes.has(permissionCode),
    );

    if (invalidPermissionCodes.length > 0) {
      throw new BadRequestException({
        message: 'One or more permission codes are invalid or inactive',
        details: {
          invalidPermissionCodes,
        },
      });
    }

    return permissions;
  }

  private async ensureRoleNameAvailable(
    organizationId: string,
    normalizedName: string,
    excludedRoleId?: string,
  ): Promise<void> {
    const existingRole = await this.prisma.role.findFirst({
      where: {
        scope: AccessScope.ORGANIZATION,
        isActive: true,
        normalizedName,
        OR: [{ organizationId: null }, { organizationId }],
        ...(excludedRoleId ? { id: { not: excludedRoleId } } : {}),
      },
      select: { id: true },
    });

    if (existingRole) {
      throw new ConflictException(
        'A role with this name already exists in the organization',
      );
    }
  }

  private async requireMutableRole(
    organizationId: string,
    roleId: string,
  ): Promise<RoleRecord> {
    const role = await this.findApplicableRole(organizationId, roleId);

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    if (role.isSystem || role.organizationId !== organizationId) {
      throw new ForbiddenException('System roles cannot be modified');
    }

    return role;
  }

  private findApplicableRole(
    organizationId: string,
    roleId: string,
  ): Promise<RoleRecord | null> {
    return this.prisma.role.findFirst({
      where: {
        id: roleId,
        scope: AccessScope.ORGANIZATION,
        isActive: true,
        OR: [{ organizationId: null }, { organizationId }],
      },
      select: this.roleSelect(organizationId),
    });
  }

  private roleSelect(organizationId: string) {
    return {
      id: true,
      organizationId: true,
      name: true,
      description: true,
      scope: true,
      isSystem: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
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
              id: true,
              code: true,
              name: true,
              description: true,
              category: true,
              scope: true,
            },
          },
        },
      },
      _count: {
        select: {
          membershipAssignments: {
            where: {
              membership: {
                is: { organizationId },
              },
            },
          },
        },
      },
    } as const satisfies Prisma.RoleSelect;
  }

  private toRoleView(role: RoleRecord): RoleView {
    return {
      id: role.id,
      organizationId: role.organizationId,
      name: role.name,
      description: role.description,
      scope: role.scope,
      isSystem: role.isSystem,
      isActive: role.isActive,
      assignedMembersCount: role._count.membershipAssignments,
      permissions: role.permissions
        .map(({ permission }) => permission)
        .sort(
          (left, right) =>
            left.category.localeCompare(right.category) ||
            left.name.localeCompare(right.name) ||
            left.code.localeCompare(right.code),
        ),
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }
}
