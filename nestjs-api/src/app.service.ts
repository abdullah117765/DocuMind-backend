import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { formatSafeLogEvent } from './common/logging/safe-log.util';
import {
  MaintenanceCleanupService,
  type MaintenanceCleanupStatus,
} from './common/tasks/maintenance-cleanup.service';
import { DocumentStorageService } from './modules/documents/document-storage.service';
import { PrismaService } from './modules/prisma/prisma.service';
import { RedisService } from './modules/redis/redis.service';

export interface HealthCheck {
  name: string;
  status: 'ok' | 'error' | 'skipped';
  latencyMs: number | null;
  message?: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  checkedAt: string;
  checks: HealthCheck[];
  maintenance: MaintenanceCleanupStatus;
}

const DEFAULT_HEALTH_TIMEOUT_MS = 2500;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`${label} timed out.`)),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function getSafeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 180) : 'Unavailable';
}

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly storageService: DocumentStorageService,
    private readonly maintenanceCleanupService: MaintenanceCleanupService,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  async getHealth(): Promise<HealthResponse> {
    const checks = await Promise.all([
      this.runCheck('postgres', () =>
        this.prisma.user.findFirst({ select: { id: true } }),
      ),
      this.runCheck('redis', () => this.redisService.ping()),
      this.runCheck('minio', () => this.storageService.checkHealth()),
      this.runHttpCheck('fastapi', this.getServiceUrl('RAG_SERVICE_URL'), '/health'),
      this.runHttpCheck('qdrant', this.getServiceUrl('QDRANT_URL'), '/healthz'),
    ]);
    const failedCriticalCheck = checks.some(
      (check) => check.status === 'error' && check.name !== 'qdrant',
    );
    const failedChecks = checks.filter((check) => check.status === 'error');

    if (failedChecks.length > 0) {
      this.logger.warn(
        formatSafeLogEvent(
          failedCriticalCheck
            ? 'system_health_degraded'
            : 'system_health_noncritical_issue',
          {
            failedServices: failedChecks.map((check) => check.name),
            checks: failedChecks.map((check) => ({
              name: check.name,
              latencyMs: check.latencyMs,
              message: check.message ?? 'Unavailable',
            })),
          },
        ),
      );
    }

    return {
      status: failedCriticalCheck ? 'degraded' : 'ok',
      checkedAt: new Date().toISOString(),
      checks,
      maintenance: this.maintenanceCleanupService.getStatus(),
    };
  }

  private async runCheck(
    name: string,
    check: () => Promise<unknown>,
  ): Promise<HealthCheck> {
    const startedAt = Date.now();

    try {
      await withTimeout(
        Promise.resolve().then(check),
        DEFAULT_HEALTH_TIMEOUT_MS,
        name,
      );

      return {
        name,
        status: 'ok',
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        name,
        status: 'error',
        latencyMs: Date.now() - startedAt,
        message: getSafeErrorMessage(error),
      };
    }
  }

  private async runHttpCheck(
    name: string,
    serviceUrl: string | null,
    path: string,
  ): Promise<HealthCheck> {
    if (!serviceUrl) {
      return {
        name,
        status: 'skipped',
        latencyMs: null,
      };
    }

    return this.runCheck(name, async () => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        DEFAULT_HEALTH_TIMEOUT_MS,
      );

      try {
        const response = await fetch(`${serviceUrl}${path}`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`${name} returned HTTP ${response.status}.`);
        }
      } finally {
        clearTimeout(timeout);
      }
    });
  }

  private getServiceUrl(name: string): string | null {
    const value = this.configService.get<string>(name)?.trim();

    if (!value) return name === 'QDRANT_URL' ? 'http://localhost:6333' : null;

    return value.replace(/\/+$/, '');
  }
}
