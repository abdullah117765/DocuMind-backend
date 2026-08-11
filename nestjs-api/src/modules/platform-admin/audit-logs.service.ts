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

const AUDIT_LOG_EXPORT_LIMIT = 5000;

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

export interface AuditLogExportResult {
  filename: string;
  content: string;
  count: number;
  truncated: boolean;
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

  async exportAuditLogs(
    query: ListAuditLogsQueryDto,
    principal: AuthenticatedPrincipal,
  ): Promise<AuditLogExportResult> {
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
    const logs = await this.prisma.auditLog.findMany({
      where,
      select: auditLogSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: AUDIT_LOG_EXPORT_LIMIT + 1,
    });
    const visibleLogs = logs.slice(0, AUDIT_LOG_EXPORT_LIMIT).map((log) =>
      this.toView(log),
    );
    const requestedScope = forcedOrganizationId ?? query.organizationId ?? null;
    const timestamp = new Date().toISOString();
    const filenameScope = requestedScope ? `organization-${requestedScope}` : 'platform';
    const filename = `audit-logs-${filenameScope}-${timestamp.slice(0, 10)}.txt`;
    const content = this.formatAuditLogsText({
      filters: query,
      generatedAt: timestamp,
      logs: visibleLogs,
      truncated: logs.length > AUDIT_LOG_EXPORT_LIMIT,
    });

    return {
      filename,
      content,
      count: visibleLogs.length,
      truncated: logs.length > AUDIT_LOG_EXPORT_LIMIT,
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

  private formatAuditLogsText(input: {
    filters: ListAuditLogsQueryDto;
    generatedAt: string;
    logs: AuditLogView[];
    truncated: boolean;
  }): string {
    const lines: string[] = [
      'DOCUMIND Audit Logs',
      `Generated at: ${input.generatedAt}`,
      `Records exported: ${input.logs.length}`,
      input.truncated
        ? `Note: Export was limited to the latest ${AUDIT_LOG_EXPORT_LIMIT} matching records.`
        : '',
      '',
      'Applied filters:',
      `- Search: ${input.filters.search?.trim() || 'Any'}`,
      `- Action: ${input.filters.action?.trim() || 'Any'}`,
      `- Outcome: ${input.filters.outcome || 'Any'}`,
      `- Organization ID: ${input.filters.organizationId || 'All allowed'}`,
      `- Actor user ID: ${input.filters.actorUserId || 'Any'}`,
      `- From: ${input.filters.from || 'Any'}`,
      `- To: ${input.filters.to || 'Any'}`,
      '',
      'Records',
      '-------',
    ].filter((line) => line !== '');

    if (input.logs.length === 0) {
      lines.push('No matching audit logs found.');
      return `${lines.join('\n')}\n`;
    }

    input.logs.forEach((log, index) => {
      const actor = log.actor;
      const status =
        typeof log.statusCode === 'number' && log.statusCode >= 400
          ? 'Needs review'
          : 'Completed';

      lines.push(
        '',
        `#${index + 1}`,
        `When: ${log.createdAt.toISOString()}`,
        `Actor: ${
          actor
            ? `${actor.name} <${actor.email}>`
            : 'System / automated event'
        }`,
        `Organization: ${log.organization?.name ?? 'Platform'}${
          log.organization?.slug ? ` (${log.organization.slug})` : ''
        }`,
        `Action: ${log.action}`,
        `Area: ${log.resource}`,
        `Status: ${status}${
          typeof log.statusCode === 'number' ? ` (${log.statusCode})` : ''
        }`,
        `IP address: ${log.ipAddress ?? 'Not captured'}`,
        `Device: ${log.userAgent ?? 'Not captured'}`,
        `Details: ${this.formatMetadataForExport(log.metadata)}`,
      );
    });

    return `${lines.join('\n')}\n`;
  }

  private formatMetadataForExport(metadata: Prisma.JsonValue | null): string {
    if (
      !metadata ||
      typeof metadata !== 'object' ||
      Array.isArray(metadata) ||
      Object.keys(metadata).length === 0
    ) {
      return 'No extra details for this event.';
    }

    const record = metadata as Record<string, unknown>;
    const details: string[] = [];

    if (typeof record.reason === 'string' && record.reason.trim()) {
      details.push(`Reason: ${record.reason.trim()}`);
    }

    if (typeof record.message === 'string' && record.message.trim()) {
      details.push(record.message.trim());
    }

    if (record.oldRole || record.newRole) {
      details.push(
        `Role changed from ${String(record.oldRole ?? 'previous role')} to ${String(
          record.newRole ?? 'new role',
        )}.`,
      );
    }

    if (
      typeof record.targetUserEmail === 'string' &&
      record.targetUserEmail.trim()
    ) {
      details.push(`User: ${record.targetUserEmail.trim()}`);
    }

    return details.length
      ? details.join(' ')
      : 'Additional details are available in the system audit record.';
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
