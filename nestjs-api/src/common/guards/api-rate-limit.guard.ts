import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type {
  RateLimitConfiguration,
  RateLimitRuleConfiguration,
} from '../../config/rate-limit.config';
import { RedisService } from '../../modules/redis/redis.service';

interface RateLimitRule {
  name: string;
  config: RateLimitRuleConfiguration;
}

function getClientIp(request: Request): string {
  const forwardedFor = request.headers['x-forwarded-for'];
  const rawIp =
    typeof forwardedFor === 'string'
      ? forwardedFor.split(',')[0]?.trim()
      : request.ip || request.socket.remoteAddress || 'unknown';

  return rawIp.slice(0, 64);
}

function getPath(request: Request): string {
  return (request.originalUrl || request.url || '').split('?')[0] || '/';
}

function stripApiPrefix(path: string): string {
  return path.replace(/^\/api(?=\/|$)/, '') || '/';
}

function isStateChangingMethod(method: string): boolean {
  return ['DELETE', 'PATCH', 'POST', 'PUT'].includes(method);
}

@Injectable()
export class ApiRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(ApiRateLimitGuard.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    const config = this.configService.get<RateLimitConfiguration>('rateLimit');

    if (!config?.enabled || this.shouldSkip(request)) {
      return true;
    }

    const rule = this.selectRule(request, config);
    const identifier = this.getIdentifier(request, rule);

    try {
      const state = await this.redisService.recordRateLimitAttempt(
        rule.name,
        identifier,
        rule.config.windowSeconds,
      );
      const remaining = Math.max(rule.config.maxRequests - state.attempts, 0);

      response.setHeader('RateLimit-Limit', String(rule.config.maxRequests));
      response.setHeader('RateLimit-Remaining', String(remaining));
      response.setHeader(
        'RateLimit-Reset',
        String(Math.max(state.retryAfterSeconds, 0)),
      );

      if (state.attempts <= rule.config.maxRequests) {
        return true;
      }

      response.setHeader('Retry-After', String(state.retryAfterSeconds));

      throw new HttpException(
        {
          message: 'Too many requests. Please wait a moment and try again.',
          details: {
            retryAfterSeconds: state.retryAfterSeconds,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.warn(
        `API rate limit check skipped after Redis error: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );

      return true;
    }
  }

  private shouldSkip(request: Request): boolean {
    if (request.method === 'OPTIONS') return true;

    const path = stripApiPrefix(getPath(request));

    return (
      path === '/' ||
      path === '/health' ||
      path.startsWith('/health/') ||
      path.endsWith('/events')
    );
  }

  private selectRule(
    request: Request,
    config: RateLimitConfiguration,
  ): RateLimitRule {
    const method = request.method.toUpperCase();
    const path = stripApiPrefix(getPath(request));

    if (method === 'POST' && path.includes('/documents/rag/ask')) {
      return { name: 'rag-ask', config: config.ragAsk };
    }

    if (method === 'POST' && path.includes('/documents/rag/reindex')) {
      return { name: 'rag-reindex', config: config.ragReindex };
    }

    if (method === 'POST' && path.includes('/documents/rag/search')) {
      return { name: 'rag-search', config: config.ragSearch };
    }

    if (
      method === 'POST' &&
      path.includes('/documents') &&
      (path.includes('/stage') ||
        path.includes('/commit') ||
        path.includes('/versions'))
    ) {
      return { name: 'document-upload', config: config.documentUpload };
    }

    if (isStateChangingMethod(method)) {
      return { name: 'state-changing', config: config.stateChanging };
    }

    return { name: 'general', config: config.general };
  }

  private getIdentifier(request: Request, rule: RateLimitRule): string {
    const user = request.user as { userId?: string } | undefined;
    const principal = user?.userId ? `user:${user.userId}` : `ip:${getClientIp(request)}`;

    return `${principal}:${request.method}:${rule.name}`;
  }
}
