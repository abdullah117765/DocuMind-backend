import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import { PrismaService } from '../prisma/prisma.service';

const AUDITED_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const REDACTED_KEYS = new Set([
  'accessToken',
  'apiKey',
  'authorization',
  'confirmPassword',
  'cookie',
  'currentPassword',
  'inviteToken',
  'newPassword',
  'otp',
  'password',
  'passwordHash',
  'refreshToken',
  'resetToken',
  'token',
  'tokenHash',
  'token_hash',
]);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AuditRequest = Request & {
  user?: AuthenticatedPrincipal;
};

interface AuditActorSnapshot {
  userId: string | null;
  email: string | null;
  name: string | null;
}

function getClientIp(request: Request): string | null {
  const forwardedFor = request.headers['x-forwarded-for'];
  const rawIp =
    typeof forwardedFor === 'string'
      ? forwardedFor.split(',')[0]?.trim()
      : request.ip || request.socket.remoteAddress;

  return rawIp ? rawIp.slice(0, 45) : null;
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      isSensitiveKey(key) ? '[REDACTED]' : sanitizeValue(entry),
    ]),
  );
}

function isSensitiveKey(key: string): boolean {
  if (REDACTED_KEYS.has(key)) return true;

  const normalizedKey = key.toLowerCase().replace(/[\s_-]+/g, '');

  return (
    normalizedKey.includes('password') ||
    normalizedKey.includes('token') ||
    normalizedKey.includes('secret') ||
    normalizedKey.includes('authorization') ||
    normalizedKey.includes('cookie') ||
    normalizedKey.includes('apikey') ||
    normalizedKey === 'otp'
  );
}

function getPath(request: Request): string {
  return (request.originalUrl || request.url || '').split('?')[0] || '/';
}

function getResource(path: string): string {
  const segments = path
    .split('/')
    .filter(Boolean)
    .filter((segment) => segment !== 'api' && !UUID_PATTERN.test(segment));

  if (segments[0] === 'platform' && segments[1]) {
    return `platform.${segments[1]}`.slice(0, 120);
  }

  if (segments[0] === 'organizations' && segments[2]) {
    return `organization.${segments[2]}`.slice(0, 120);
  }

  return (segments[0] ?? 'root').slice(0, 120);
}

function getStatusCode(error: unknown, response: Response): number {
  if (error instanceof HttpException) {
    return error.getStatus();
  }

  return response.statusCode >= 400 ? response.statusCode : 500;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase().slice(0, 254);
}

function getRequestEmail(request: AuditRequest): string | null {
  const email =
    typeof request.body?.email === 'string' ? request.body.email : null;

  return email && email.includes('@') ? normalizeEmail(email) : null;
}

function getActorSnapshot(request: AuditRequest): AuditActorSnapshot | null {
  if (request.user) {
    return {
      userId: request.user.userId,
      email: normalizeEmail(request.user.email),
      name: request.user.name?.trim().slice(0, 150) || null,
    };
  }

  const email = getRequestEmail(request);

  if (!email) {
    return null;
  }

  return {
    userId: null,
    email,
    name: null,
  };
}

function buildMetadata(
  request: AuditRequest,
  durationMs: number,
  actor: AuditActorSnapshot | null,
  error?: unknown,
): Prisma.InputJsonValue {
  const metadata = {
    durationMs,
    actor: actor
      ? {
          ...(actor.userId ? { userId: actor.userId } : {}),
          ...(actor.email ? { email: actor.email } : {}),
          ...(actor.name ? { name: actor.name } : {}),
        }
      : null,
    params: sanitizeValue(request.params ?? {}),
    query: sanitizeValue(request.query ?? {}),
    body: sanitizeValue(request.body ?? {}),
    ...(error
      ? {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : { message: 'Request failed' },
        }
      : {}),
  };

  return JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonValue;
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<AuditRequest>();
    const response = httpContext.getResponse<Response>();

    if (!AUDITED_METHODS.has(request.method)) {
      return next.handle();
    }

    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        this.writeAuditLog(
          request,
          response.statusCode,
          Date.now() - startedAt,
        );
      }),
      catchError((error: unknown) => {
        this.writeAuditLog(
          request,
          getStatusCode(error, response),
          Date.now() - startedAt,
          error,
        );

        return throwError(() => error);
      }),
    );
  }

  private writeAuditLog(
    request: AuditRequest,
    statusCode: number,
    durationMs: number,
    error?: unknown,
  ): void {
    const path = getPath(request);
    const organizationId =
      typeof request.params?.organizationId === 'string' &&
      UUID_PATTERN.test(request.params.organizationId)
        ? request.params.organizationId
        : null;
    const actor = getActorSnapshot(request);

    void this.prisma.auditLog
      .create({
        data: {
          actorUserId: actor?.userId ?? null,
          actorName: actor?.name ?? null,
          actorEmail: actor?.email ?? null,
          organizationId,
          action: `${request.method} ${path}`.slice(0, 160),
          method: request.method.slice(0, 12),
          path: path.slice(0, 500),
          resource: getResource(path),
          statusCode,
          ipAddress: getClientIp(request),
          userAgent:
            typeof request.headers['user-agent'] === 'string'
              ? request.headers['user-agent']
              : null,
          metadata: buildMetadata(request, durationMs, actor, error),
        },
      })
      .catch(() => {
        // Audit logging must never block or fail the user-facing request.
      });
  }
}
