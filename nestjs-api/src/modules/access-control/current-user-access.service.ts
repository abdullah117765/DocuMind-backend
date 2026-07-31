import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AccessScope,
  OrganizationMembershipStatus,
} from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
  };
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
  ) {}

  async getCurrentUserAccess(userId: string): Promise<CurrentUserAccessView> {
    const [platform, memberships, globalOrganizationGrant] = await Promise.all([
      this.accessControlService.resolvePlatformAccess(userId),
      this.prisma.organizationMembership.findMany({
        where: {
          userId,
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
      this.prisma.platformUserRole.findFirst({
        where: {
          userId,
          role: {
            is: {
              organizationId: null,
              scope: AccessScope.PLATFORM,
              isActive: true,
              permissions: {
                some: {
                  permission: {
                    is: {
                      scope: AccessScope.ORGANIZATION,
                      isActive: true,
                    },
                  },
                },
              },
            },
          },
        },
        select: {
          roleId: true,
        },
      }),
    ]);
    const organizationAccess = await Promise.all(
      memberships.map((membership) =>
        this.accessControlService.resolveOrganizationAccess(
          userId,
          membership.organization.id,
        ),
      ),
    );

    return {
      platform,
      hasGlobalOrganizationAccess: Boolean(globalOrganizationGrant),
      organizations: memberships.map((membership, index) => ({
        organization: membership.organization,
        membership: {
          id: membership.id,
          status: membership.status,
        },
        roles: organizationAccess[index]?.roles ?? [],
        permissions: organizationAccess[index]?.permissions ?? [],
      })),
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
