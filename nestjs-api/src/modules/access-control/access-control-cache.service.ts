import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { AccessControlConfiguration } from '../../config/access-control.config';
import { AccessScope } from '../../generated/prisma/client';
import { REDIS_CLIENT } from '../redis/redis.constants';
import {
  AccessCacheLookup,
  AccessCacheStamp,
  EffectiveRole,
  OrganizationAccess,
  PlatformAccess,
} from './access-control.types';

const CACHE_PREFIX = 'access-control:v1';
const VERSION_PATTERN = /^(?:0|[1-9]\d*)$/;

function globalVersionKey(): string {
  return `${CACHE_PREFIX}:version:global`;
}

function userVersionKey(userId: string): string {
  return `${CACHE_PREFIX}:version:user:${userId}`;
}

function organizationVersionKey(organizationId: string): string {
  return `${CACHE_PREFIX}:version:organization:${organizationId}`;
}

function normalizeVersion(value: string | null): string {
  return value && VERSION_PATTERN.test(value) ? value : '0';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEffectiveRole(value: unknown): value is EffectiveRole {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.scope === AccessScope.PLATFORM ||
      value.scope === AccessScope.ORGANIZATION)
  );
}

function hasValidAccessArrays(value: Record<string, unknown>): value is Record<
  string,
  unknown
> & {
  roles: EffectiveRole[];
  permissions: string[];
} {
  return (
    Array.isArray(value.roles) &&
    value.roles.every(isEffectiveRole) &&
    Array.isArray(value.permissions) &&
    value.permissions.every(
      (permission): permission is string => typeof permission === 'string',
    )
  );
}

function parsePlatformAccess(
  rawValue: string,
  expectedUserId: string,
): PlatformAccess | null {
  try {
    const value: unknown = JSON.parse(rawValue);

    if (
      !isRecord(value) ||
      value.userId !== expectedUserId ||
      !hasValidAccessArrays(value)
    ) {
      return null;
    }

    return {
      userId: expectedUserId,
      roles: value.roles,
      permissions: value.permissions,
    };
  } catch {
    return null;
  }
}

function parseOrganizationAccess(
  rawValue: string,
  expectedUserId: string,
  expectedOrganizationId: string,
): OrganizationAccess | null {
  try {
    const value: unknown = JSON.parse(rawValue);

    if (
      !isRecord(value) ||
      value.userId !== expectedUserId ||
      value.organizationId !== expectedOrganizationId ||
      (value.membershipId !== null && typeof value.membershipId !== 'string') ||
      !hasValidAccessArrays(value)
    ) {
      return null;
    }

    return {
      userId: expectedUserId,
      organizationId: expectedOrganizationId,
      membershipId: value.membershipId,
      roles: value.roles,
      permissions: value.permissions,
    };
  } catch {
    return null;
  }
}

@Injectable()
export class AccessControlCacheService {
  private readonly ttlSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT)
    private readonly client: Redis,
    configService: ConfigService,
  ) {
    const config =
      configService.getOrThrow<AccessControlConfiguration>('accessControl');
    this.ttlSeconds = config.cacheTtlSeconds;
  }

  async getPlatformAccess(
    userId: string,
  ): Promise<AccessCacheLookup<PlatformAccess>> {
    const stamp = await this.readStamp(userId);
    const key = this.platformCacheKey(userId, stamp);
    const rawValue = await this.client.get(key);

    if (!rawValue) {
      return { stamp, value: null };
    }

    const value = parsePlatformAccess(rawValue, userId);

    if (!value) {
      await this.client.del(key);
    }

    return { stamp, value };
  }

  async setPlatformAccess(
    userId: string,
    stamp: AccessCacheStamp,
    value: PlatformAccess,
  ): Promise<boolean> {
    if (!(await this.isCurrentStamp(userId, stamp))) {
      return false;
    }

    await this.client.set(
      this.platformCacheKey(userId, stamp),
      JSON.stringify(value),
      'EX',
      this.ttlSeconds,
    );

    return true;
  }

  async getOrganizationAccess(
    userId: string,
    organizationId: string,
  ): Promise<AccessCacheLookup<OrganizationAccess>> {
    const stamp = await this.readStamp(userId, organizationId);
    const key = this.organizationCacheKey(userId, organizationId, stamp);
    const rawValue = await this.client.get(key);

    if (!rawValue) {
      return { stamp, value: null };
    }

    const value = parseOrganizationAccess(rawValue, userId, organizationId);

    if (!value) {
      await this.client.del(key);
    }

    return { stamp, value };
  }

  async setOrganizationAccess(
    userId: string,
    organizationId: string,
    stamp: AccessCacheStamp,
    value: OrganizationAccess,
  ): Promise<boolean> {
    if (!(await this.isCurrentStamp(userId, stamp, organizationId))) {
      return false;
    }

    await this.client.set(
      this.organizationCacheKey(userId, organizationId, stamp),
      JSON.stringify(value),
      'EX',
      this.ttlSeconds,
    );

    return true;
  }

  async invalidateUser(userId: string): Promise<void> {
    await this.client.incr(userVersionKey(userId));
  }

  async invalidateOrganization(organizationId: string): Promise<void> {
    await this.client.incr(organizationVersionKey(organizationId));
  }

  async invalidateAll(): Promise<void> {
    await this.client.incr(globalVersionKey());
  }

  private async readStamp(
    userId: string,
    organizationId?: string,
  ): Promise<AccessCacheStamp> {
    const keys = [globalVersionKey(), userVersionKey(userId)];

    if (organizationId) {
      keys.push(organizationVersionKey(organizationId));
    }

    const versions = await this.client.mget(...keys);

    return {
      globalVersion: normalizeVersion(versions[0] ?? null),
      userVersion: normalizeVersion(versions[1] ?? null),
      ...(organizationId
        ? {
            organizationVersion: normalizeVersion(versions[2] ?? null),
          }
        : {}),
    };
  }

  private async isCurrentStamp(
    userId: string,
    stamp: AccessCacheStamp,
    organizationId?: string,
  ): Promise<boolean> {
    const currentStamp = await this.readStamp(userId, organizationId);

    return (
      currentStamp.globalVersion === stamp.globalVersion &&
      currentStamp.userVersion === stamp.userVersion &&
      currentStamp.organizationVersion === stamp.organizationVersion
    );
  }

  private platformCacheKey(userId: string, stamp: AccessCacheStamp): string {
    return [
      CACHE_PREFIX,
      'platform',
      stamp.globalVersion,
      stamp.userVersion,
      userId,
    ].join(':');
  }

  private organizationCacheKey(
    userId: string,
    organizationId: string,
    stamp: AccessCacheStamp,
  ): string {
    return [
      CACHE_PREFIX,
      'organization',
      stamp.globalVersion,
      stamp.userVersion,
      stamp.organizationVersion ?? '0',
      organizationId,
      userId,
    ].join(':');
  }
}
