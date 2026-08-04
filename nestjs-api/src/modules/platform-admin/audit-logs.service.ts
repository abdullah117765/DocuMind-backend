import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

const auditLogSelect = {
  id: true,
  actorUserId: true,
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
    id: string;
    email: string;
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
  constructor(private readonly prisma: PrismaService) {}

  async listAuditLogs(
    query: ListAuditLogsQueryDto,
  ): Promise<AuditLogListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where = this.buildWhere(query);
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

  private buildWhere(query: ListAuditLogsQueryDto): Prisma.AuditLogWhereInput {
    const search = query.search?.trim();
    const createdAt: Prisma.DateTimeFilter = {
      ...(query.from ? { gte: new Date(query.from) } : {}),
      ...(query.to ? { lte: new Date(query.to) } : {}),
    };

    return {
      ...(query.action ? { action: { contains: query.action } } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
      ...(search
        ? {
            OR: [
              { action: { contains: search, mode: Prisma.QueryMode.insensitive } },
              { path: { contains: search, mode: Prisma.QueryMode.insensitive } },
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
      actor: log.actor,
      organization: log.organization,
    };
  }
}
