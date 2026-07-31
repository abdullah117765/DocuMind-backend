import { AccessScope } from '../../generated/prisma/client';

export interface EffectiveRole {
  id: string;
  name: string;
  scope: AccessScope;
}

export interface PlatformAccess {
  userId: string;
  roles: EffectiveRole[];
  permissions: string[];
}

export interface OrganizationAccess extends PlatformAccess {
  organizationId: string;
  membershipId: string | null;
}

export interface AccessCacheStamp {
  globalVersion: string;
  userVersion: string;
  organizationVersion?: string;
}

export interface AccessCacheLookup<T> {
  stamp: AccessCacheStamp;
  value: T | null;
}
