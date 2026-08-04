import { SubscriptionStatus } from '../../generated/prisma/client';

export const DEFAULT_ORGANIZATION_LIMITS = {
  maxMembers: 10,
  maxDocuments: 1000,
  maxStorageMb: 1024,
  maxMonthlyAiRequests: 1000,
} as const;

export const DEFAULT_ORGANIZATION_SUBSCRIPTION = {
  plan: 'FREE',
  status: SubscriptionStatus.ACTIVE,
} as const;

export const ORGANIZATION_INVITE_TTL_DAYS = 7;
