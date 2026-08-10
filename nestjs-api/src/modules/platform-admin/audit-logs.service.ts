import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AccessControlService } from '../access-control/access-control.service';
import { ORGANIZATION_PERMISSIONS } from '../access-control/rbac.constants';
import { EnvSuperAdminService } from '../auth/env-super-admin.service';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import { PrismaService } from '../prisma/prisma.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

const auditLogSelect = {
  id: true,
  actorUserId: true,
  actorName: true,
  actorEmail: true,
  organizationId: true,
  action: true,
  method: true,
  path: true,
  resource: true,
  statusCode: true,
  ipAddress: true,
  userAgent: true,
  metadata: true,
  createdAt: true,
  actor: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  organization: {
    select: {
      id: true,
      name: true,
      slug: true,
    },
  },
} as const satisfies Prisma.AuditLogSelect;

type AuditLogRecord = Prisma.AuditLogGetPayload<{
  select: typeof auditLogSelect;
}>;

export interface AuditLogView {
  id: string;
  actorUserId: string | null;
  organizationId: string | null;
  action: string;
  method: string;
  path: string;
  resource: string;
  statusCode: number | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
  actor: {
    id: string | null;
    email: string;
    name: string;
  } | null;
  organization: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

export interface AuditLogListResult {
  logs: AuditLogView[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}

@Injectable()
export class AuditLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
    private readonly envSuperAdminService: EnvSuperAdminService,
  ) {}

  async listAuditLogs(
    query: ListAuditLogsQueryDto,
    principal: AuthenticatedPrincipal,
  ): Promise<AuditLogListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const forcedOrganizationId = await this.resolveOrganizationScope(
      principal,
      query.organizationId,
    );
    const where = this.buildWhere(
      query,
      forcedOrganizationId,
      forcedOrganizationId
        ? this.envSuperAdminService.getConfiguredEmail()
        : null,
    );
    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        select: auditLogSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      logs: logs.map((log) => this.toView(log)),
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(Math.ceil(total / pageSize), 1),
      },
    };
  }

  private async resolveOrganizationScope(
    principal: AuthenticatedPrincipal,
    requestedOrganizationId?: string,
  ): Promise<string | null> {
    if (await this.envSuperAdminService.isConfiguredUserId(principal.userId)) {
      return null;
    }

    if (!requestedOrganizationId) {
      throw new ForbiddenException(
        'Select an organization to view its audit logs.',
      );
    }

    const access = await this.accessControlService.resolveOrganizationAccess(
      principal.userId,
      requestedOrganizationId,
    );

    if (!access?.permissions.includes(ORGANIZATION_PERMISSIONS.membersManage)) {
      throw new ForbiddenException(
        'Only organization administrators can view organization audit logs.',
      );
    }

    return requestedOrganizationId;
  }

  private buildWhere(
    query: ListAuditLogsQueryDto,
    forcedOrganizationId: string | null,
    hiddenActorEmail: string | null,
  ): Prisma.AuditLogWhereInput {
    const search = query.search?.trim();
    const createdAt: Prisma.DateTimeFilter = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };

    return {
      ...(query.action ? { action: { contains: query.action } } : {}),
      ...(query.outcome === 'success'
        ? { statusCode: { lt: 400 } }
        : query.outcome === 'warning'
          ? { statusCode: { gte: 400 } }
          : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(forcedOrganizationId
        ? { organizationId: forcedOrganizationId }
        : query.organizationId
          ? { organizationId: query.organizationId }
          : {}),
      ...(hiddenActorEmail
        ? {
            NOT: {
              OR: [
                {
                  actor: {
                    is: {
                      email: hiddenActorEmail,
                    },
                  },
                },
                {
                  actorEmail: hiddenActorEmail,
                },
                {
                  metadata: {
                    path: ['actor', 'email'],
                    equals: hiddenActorEmail,
                  },
                },
              ],
            },
          }
        : {}),
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
      ...(search
        ? {
            OR: [
              {
                action: {
                  contains: search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                path: { contains: search, mode: Prisma.QueryMode.insensitive },
              },
              {
                actorEmail: {
                  contains: search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                actorName: {
                  contains: search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                resource: {
                  contains: search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                actor: {
                  is: {
                    email: {
                      contains: search,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                },
              },
              {
                organization: {
                  is: {
                    name: {
                      contains: search,
                      mode: Prisma.QueryMode.insensitive,
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  private toView(log: AuditLogRecord): AuditLogView {
    return {
      id: log.id,
      actorUserId: log.actorUserId,
      organizationId: log.organizationId,
      action: log.action,
      method: log.method,
      path: log.path,
      resource: log.resource,
      statusCode: log.statusCode,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      metadata: log.metadata,
      createdAt: log.createdAt,
      actor: this.getActorView(log),
      organization: log.organization,
    };
  }

  private getActorView(log: AuditLogRecord): {
    id: string | null;
    email: string;
    name: string;
  } | null {
    if (log.actor) {
      return {
        id: log.actor.id,
        email: log.actor.email,
        name:
          log.actor.name ??
          log.actorName ??
          this.getActorDisplayName(log.actor.email),
      };
    }

    const metadataActor = this.getMetadataActor(log.metadata);

    if (metadataActor) {
      return metadataActor;
    }

    if (log.actorEmail) {
      return {
        id: log.actorUserId,
        email: log.actorEmail,
        name: log.actorName?.trim() || this.getActorDisplayName(log.actorEmail),
      };
    }

    return null;
  }

  private getActorDisplayName(email: string): string {
    if (this.envSuperAdminService.isConfiguredEmail(email)) {
      return this.envSuperAdminService.getDisplayName() ?? 'Super Admin';
    }

    return email.split('@')[0] || email;
  }

  private getMetadataActor(metadata: Prisma.JsonValue | null): {
    id: string | null;
    email: string;
    name: string;
  } | null {
    if (
      typeof metadata !== 'object' ||
      metadata === null ||
      Array.isArray(metadata) ||
      typeof metadata.actor !== 'object' ||
      metadata.actor === null ||
      Array.isArray(metadata.actor)
    ) {
      return null;
    }

    const actor = metadata.actor as Record<string, unknown>;

    if (typeof actor.email !== 'string') {
      return null;
    }

    return {
      id: typeof actor.userId === 'string' ? actor.userId : null,
      email: actor.email,
      name:
        typeof actor.name === 'string' && actor.name.trim()
          ? actor.name.trim()
          : this.getActorDisplayName(actor.email),
    };
  }
}
