import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AccessScope,
  OrganizationMembershipStatus,
  OrganizationStatus,
  Prisma,
} from '../../generated/prisma/client';
import { AccessControlService } from '../access-control/access-control.service';
import {
  ORGANIZATION_ROLE_KEYS,
  PLATFORM_ROLE_KEYS,
} from '../access-control/rbac.constants';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationSettingsDto } from './dto/update-organization-settings.dto';
import { UpdatePlatformOrganizationDto } from './dto/update-platform-organization.dto';
import {
  DEFAULT_ORGANIZATION_LIMITS,
  DEFAULT_ORGANIZATION_SUBSCRIPTION,
} from './organization-defaults';

const MAX_SLUG_ATTEMPTS = 50;

const organizationSelect = {
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
} as const satisfies Prisma.OrganizationSelect;

type OrganizationRecord = Prisma.OrganizationGetPayload<{
  select: typeof organizationSelect;
}>;

export interface PlatformOrganizationView {
  id: string;
  name: string;
  slug: string;
  createdByUserId: string | null;
  status: OrganizationStatus;
  allowJoinRequests: boolean;
  createdAt: Date;
  updatedAt: Date;
  memberCount: number;
}

function normalizeOrganizationName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function buildSlugSeed(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 100)
    .replace(/-+$/g, '');

  return slug || 'organization';
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
  ) {}

  async listOrganizations(): Promise<PlatformOrganizationView[]> {
    const organizations = await this.prisma.organization.findMany({
      select: organizationSelect,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    return organizations.map((organization) => this.toView(organization));
  }

  async getOrganization(
    organizationId: string,
  ): Promise<PlatformOrganizationView> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: organizationSelect,
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return this.toView(organization);
  }

  async createOrganization(
    actorUserId: string,
    dto: CreateOrganizationDto,
  ): Promise<PlatformOrganizationView> {
    const name = normalizeOrganizationName(dto.name);
    const slugSeed = buildSlugSeed(dto.slug ?? name);
    const slug = dto.slug
      ? slugSeed
      : await this.resolveAvailableGeneratedSlug(slugSeed);

    const firstAdminEmail = dto.firstAdminEmail?.trim().toLowerCase();
    const firstAdmin = firstAdminEmail
      ? await this.resolveFirstOrganizationAdmin(firstAdminEmail)
      : null;
    const subscriptionData = {
      organizationId: '',
      plan: dto.subscription?.plan ?? DEFAULT_ORGANIZATION_SUBSCRIPTION.plan,
      status:
        dto.subscription?.status ?? DEFAULT_ORGANIZATION_SUBSCRIPTION.status,
      currentPeriodEndsAt:
        dto.subscription?.currentPeriodEndsAt === undefined
          ? null
          : dto.subscription.currentPeriodEndsAt
            ? new Date(dto.subscription.currentPeriodEndsAt)
            : null,
    };
    const limitsData = {
      ...DEFAULT_ORGANIZATION_LIMITS,
      ...dto.limits,
    };

    try {
      const organization = await this.prisma.$transaction(
        async (transaction) => {
          const createdOrganization = await transaction.organization.create({
            data: {
              name,
              slug,
              createdByUserId: actorUserId,
              allowJoinRequests: dto.allowJoinRequests ?? true,
            },
            select: { id: true },
          });

          await transaction.organizationSubscription.create({
            data: {
              ...subscriptionData,
              organizationId: createdOrganization.id,
            },
          });
          await transaction.organizationLimit.create({
            data: {
              organizationId: createdOrganization.id,
              ...limitsData,
            },
          });

          if (firstAdmin) {
            const membership = await transaction.organizationMembership.create({
              data: {
                organizationId: createdOrganization.id,
                userId: firstAdmin.userId,
                status: OrganizationMembershipStatus.ACTIVE,
              },
              select: { id: true },
            });

            await transaction.membershipRole.create({
              data: {
                membershipId: membership.id,
                roleId: firstAdmin.roleId,
                assignedByUserId: actorUserId,
              },
            });
          }

          return transaction.organization.findUniqueOrThrow({
            where: { id: createdOrganization.id },
            select: organizationSelect,
          });
        },
      );

      await Promise.all([
        this.accessControlService.invalidateOrganizationAccess(organization.id),
        firstAdmin
          ? this.accessControlService.invalidateUserAccess(firstAdmin.userId)
          : Promise.resolve(),
      ]);

      return this.toView(organization);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Organization slug is already in use');
      }

      throw error;
    }
  }

  async updateOrganizationSettings(
    organizationId: string,
    dto: UpdateOrganizationSettingsDto,
  ): Promise<PlatformOrganizationView> {
    return this.updateOrganization(organizationId, dto);
  }

  async updatePlatformOrganization(
    organizationId: string,
    dto: UpdatePlatformOrganizationDto,
  ): Promise<PlatformOrganizationView> {
    return this.updateOrganization(organizationId, dto);
  }

  async deleteOrganization(organizationId: string): Promise<void> {
    try {
      await this.prisma.organization.delete({
        where: { id: organizationId },
      });
    } catch (error: unknown) {
      if (this.isMissingRecordError(error)) {
        throw new NotFoundException('Organization not found');
      }

      throw error;
    }

    await this.accessControlService.invalidateOrganizationAccess(
      organizationId,
    );
  }

  private async updateOrganization(
    organizationId: string,
    dto: UpdateOrganizationSettingsDto & { status?: OrganizationStatus },
  ): Promise<PlatformOrganizationView> {
    const data: Prisma.OrganizationUpdateInput = {
      ...(dto.name ? { name: normalizeOrganizationName(dto.name) } : {}),
      ...(dto.slug ? { slug: buildSlugSeed(dto.slug) } : {}),
      ...(dto.allowJoinRequests !== undefined
        ? { allowJoinRequests: dto.allowJoinRequests }
        : {}),
      ...(dto.status ? { status: dto.status } : {}),
    };

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('At least one organization field is required');
    }

    try {
      const organization = await this.prisma.organization.update({
        where: { id: organizationId },
        data,
        select: organizationSelect,
      });

      await this.accessControlService.invalidateOrganizationAccess(
        organizationId,
      );

      return this.toView(organization);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Organization slug is already in use');
      }

      if (this.isMissingRecordError(error)) {
        throw new NotFoundException('Organization not found');
      }

      throw error;
    }
  }

  private async resolveFirstOrganizationAdmin(email: string): Promise<{
    userId: string;
    roleId: string;
  }> {
    const [user, role] = await Promise.all([
      this.prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          isActive: true,
          isVerified: true,
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
      }),
      this.prisma.role.findFirst({
        where: {
          systemKey: ORGANIZATION_ROLE_KEYS.organizationAdmin,
          scope: AccessScope.ORGANIZATION,
          organizationId: null,
          isActive: true,
        },
        select: { id: true },
      }),
    ]);

    if (!user || !user.isActive || !user.isVerified) {
      throw new NotFoundException(
        'First Organization Admin must be an active verified user',
      );
    }

    if (user.platformRoleAssignments.length > 0) {
      throw new ConflictException({
        message:
          'Super Admin accounts operate from the platform level and cannot become organization members.',
        details: {
          reason: 'PLATFORM_ADMIN_CANNOT_JOIN_ORGANIZATION',
        },
      });
    }

    if (!role) {
      throw new ConflictException('Organization Admin role is not configured');
    }

    return {
      userId: user.id,
      roleId: role.id,
    };
  }

  private async resolveAvailableGeneratedSlug(seed: string): Promise<string> {
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
      const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
      const candidate = `${seed.slice(0, 100 - suffix.length)}${suffix}`;
      const existingOrganization = await this.prisma.organization.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });

      if (!existingOrganization) {
        return candidate;
      }
    }

    throw new ConflictException('Organization slug is already in use');
  }

  private toView(organization: OrganizationRecord): PlatformOrganizationView {
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdByUserId: organization.createdByUserId,
      status: organization.status,
      allowJoinRequests: organization.allowJoinRequests,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
      memberCount: organization._count.memberships,
    };
  }

  private isMissingRecordError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    );
  }
}
