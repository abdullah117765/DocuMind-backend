import { Injectable, NotFoundException } from '@nestjs/common';
import {
  OrganizationMembershipStatus,
  OrganizationStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EnvSuperAdminService } from '../auth/env-super-admin.service';
import { AccessControlService } from './access-control.service';
import {
  EffectiveRole,
  OrganizationAccess,
  PlatformAccess,
} from './access-control.types';

export interface CurrentOrganizationAccessView {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  membership: {
    id: string;
    status: OrganizationMembershipStatus;
  } | null;
  roles: EffectiveRole[];
  permissions: string[];
}

export interface CurrentUserAccessView {
  platform: PlatformAccess;
  hasGlobalOrganizationAccess: boolean;
  organizations: CurrentOrganizationAccessView[];
}

export interface SelectedOrganizationAccessView {
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  access: OrganizationAccess;
}

@Injectable()
export class CurrentUserAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
    private readonly envSuperAdminService: EnvSuperAdminService,
  ) {}

  async getCurrentUserAccess(userId: string): Promise<CurrentUserAccessView> {
    const [platform, memberships, isEnvSuperAdmin] =
      await Promise.all([
        this.accessControlService.resolvePlatformAccess(userId),
        this.prisma.organizationMembership.findMany({
          where: {
            userId,
            status: {
              not: OrganizationMembershipStatus.REMOVED,
            },
            organization: {
              is: {
                status: OrganizationStatus.ACTIVE,
              },
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
          },
          orderBy: [
            {
              organization: {
                name: 'asc',
              },
            },
            { id: 'asc' },
          ],
        }),
        this.envSuperAdminService.isConfiguredUserId(userId),
      ]);
    const membershipByOrganizationId = new Map(
      memberships.map((membership) => [membership.organization.id, membership]),
    );
    const organizations =
      isEnvSuperAdmin
        ? await this.prisma.organization.findMany({
            where: { status: OrganizationStatus.ACTIVE },
            select: {
              id: true,
              name: true,
              slug: true,
            },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
          })
        : memberships.map((membership) => membership.organization);
    const organizationAccess = await Promise.all(
      organizations.map((organization) =>
        this.accessControlService.resolveOrganizationAccess(
          userId,
          organization.id,
        ),
      ),
    );

    return {
      platform,
      hasGlobalOrganizationAccess: isEnvSuperAdmin,
      organizations: organizations.map((organization, index) => {
        const membership = membershipByOrganizationId.get(organization.id);

        return {
          organization,
          membership: membership
            ? {
                id: membership.id,
                status: membership.status,
              }
            : null,
          roles: organizationAccess[index]?.roles ?? [],
          permissions: organizationAccess[index]?.permissions ?? [],
        };
      }),
    };
  }

  async getSelectedOrganizationAccess(
    userId: string,
    organizationId: string,
  ): Promise<SelectedOrganizationAccessView> {
    const [organization, access] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          slug: true,
        },
      }),
      this.accessControlService.resolveOrganizationAccess(
        userId,
        organizationId,
      ),
    ]);

    if (
      !organization ||
      !access ||
      (!access.membershipId && access.permissions.length === 0)
    ) {
      throw new NotFoundException('Organization access not found');
    }

    return {
      organization,
      access,
    };
  }
}
