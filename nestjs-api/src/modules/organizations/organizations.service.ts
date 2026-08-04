import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import {
  AccessScope,
  OrganizationMembershipStatus,
  Prisma,
} from '../../generated/prisma/client';
import { AccessControlService } from '../access-control/access-control.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import {
  DEFAULT_ORGANIZATION_LIMITS,
  DEFAULT_ORGANIZATION_SUBSCRIPTION,
} from './organization-defaults';

const ORGANIZATION_ADMIN_SYSTEM_KEY = 'organization_admin';
const MAX_SLUG_ATTEMPTS = 50;

const organizationSelect = {
  id: true,
  name: true,
  slug: true,
  createdByUserId: true,
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

  async createOrganization(
    actorUserId: string,
    dto: CreateOrganizationDto,
  ): Promise<PlatformOrganizationView> {
    const name = normalizeOrganizationName(dto.name);
    const slugSeed = buildSlugSeed(dto.slug ?? name);
    const slug = dto.slug
      ? slugSeed
      : await this.resolveAvailableGeneratedSlug(slugSeed);

    try {
      const organization = await this.prisma.$transaction(
        async (transaction) => {
          const adminRole = await transaction.role.findFirst({
            where: {
              systemKey: ORGANIZATION_ADMIN_SYSTEM_KEY,
              scope: AccessScope.ORGANIZATION,
              isActive: true,
            },
            select: { id: true },
          });

          if (!adminRole) {
            throw new InternalServerErrorException(
              'System organization admin role is not configured',
            );
          }

          const createdOrganization = await transaction.organization.create({
            data: {
              name,
              slug,
              createdByUserId: actorUserId,
            },
            select: { id: true },
          });
          const membership = await transaction.organizationMembership.create({
            data: {
              organizationId: createdOrganization.id,
              userId: actorUserId,
              status: OrganizationMembershipStatus.ACTIVE,
            },
            select: { id: true },
          });

          await transaction.membershipRole.create({
            data: {
              membershipId: membership.id,
              roleId: adminRole.id,
              assignedByUserId: actorUserId,
            },
          });
          await transaction.organizationSubscription.create({
            data: {
              organizationId: createdOrganization.id,
              plan: DEFAULT_ORGANIZATION_SUBSCRIPTION.plan,
              status: DEFAULT_ORGANIZATION_SUBSCRIPTION.status,
            },
          });
          await transaction.organizationLimit.create({
            data: {
              organizationId: createdOrganization.id,
              ...DEFAULT_ORGANIZATION_LIMITS,
            },
          });

          return transaction.organization.findUniqueOrThrow({
            where: { id: createdOrganization.id },
            select: organizationSelect,
          });
        },
      );

      await this.accessControlService.invalidateUserAccess(actorUserId);

      return this.toView(organization);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Organization slug is already in use');
      }

      throw error;
    }
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
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
      memberCount: organization._count.memberships,
    };
  }
}
