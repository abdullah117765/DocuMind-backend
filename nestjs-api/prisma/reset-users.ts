import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import Redis from 'ioredis';
import { AccessScope, Prisma, PrismaClient } from '../src/generated/prisma/client';

const CONFIRMATION_VALUE = 'RESET_TEST_USERS';
const SUPER_ADMIN_SYSTEM_KEY = 'super_admin';
const ACCESS_CONTROL_GLOBAL_VERSION_KEY = 'access-control:v1:version:global';
const ENV_ONLY_PASSWORD_HASH_PLACEHOLDER =
  '$2b$12$puR9afvrAILWKKnVKbDCX.0CXlT.969TXmlk0BC2aAbR/9yjc5..y';

interface ResetSummary {
  database: string;
  dryRun: boolean;
  keepUsers: Array<{
    id: string;
    email: string;
    platformRoles: string[];
  }>;
  counts: {
    totalUsers: number;
    usersToDelete: number;
    organizationInvitesToDelete: number;
    joinRequestsToDelete: number;
    auditLogsToDelete: number;
  };
}

function getConnectionString(): string {
  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error('DATABASE_URL is required to reset users.');
  }

  return connectionString;
}

function describeDatabase(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const databaseName = url.pathname.replace(/^\//, '') || '(unknown-db)';
    const port = url.port ? `:${url.port}` : '';

    return `${url.hostname}${port}/${databaseName}`;
  } catch {
    return '(database-url-hidden)';
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getKeepEmails(): string[] {
  return (process.env.RESET_KEEP_EMAILS ?? '')
    .split(',')
    .map(normalizeEmail)
    .filter((email) => email.length > 0);
}

function getConfiguredSuperAdmin():
  | {
      email: string;
    }
  | null {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim();
  const password = process.env.SUPER_ADMIN_PASSWORD;
  const name = process.env.SUPER_ADMIN_NAME?.trim();

  if (!email && !password && !name) {
    return null;
  }

  if (!email || !password || !name) {
    throw new Error(
      'Set SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, and SUPER_ADMIN_NAME together, or set none.',
    );
  }

  return {
    email: normalizeEmail(email),
  };
}

async function ensureConfiguredSuperAdminUser(
  prisma: PrismaClient,
): Promise<string | null> {
  const configuredSuperAdmin = getConfiguredSuperAdmin();

  if (!configuredSuperAdmin) {
    return null;
  }

  const user = await prisma.user.upsert({
    where: { email: configuredSuperAdmin.email },
    create: {
      email: configuredSuperAdmin.email,
      passwordHash: ENV_ONLY_PASSWORD_HASH_PLACEHOLDER,
      isVerified: true,
      isActive: true,
    },
    update: {
      isVerified: true,
      isActive: true,
      deactivatedAt: null,
    },
    select: { id: true },
  });

  await prisma.$transaction(async (transaction) => {
    await transaction.membershipRole.deleteMany({
      where: {
        membership: {
          is: {
            userId: user.id,
          },
        },
      },
    });
    await transaction.organizationMembership.deleteMany({
      where: { userId: user.id },
    });
    await transaction.platformUserRole.deleteMany({
      where: {
        OR: [
          { userId: user.id },
          {
            role: {
              is: {
                systemKey: SUPER_ADMIN_SYSTEM_KEY,
                scope: AccessScope.PLATFORM,
              },
            },
          },
        ],
      },
    });
  });

  return user.id;
}

async function buildResetSummary(
  prisma: PrismaClient,
  database: string,
  dryRun: boolean,
): Promise<ResetSummary & { keepUserIds: string[] }> {
  const configuredSuperAdmin = getConfiguredSuperAdmin();
  const keepEmails = [
    ...new Set([
      ...getKeepEmails(),
      ...(configuredSuperAdmin ? [configuredSuperAdmin.email] : []),
    ]),
  ];
  const keepWhere: Prisma.UserWhereInput = keepEmails.length
    ? {
        email: {
          in: keepEmails,
        },
      }
    : {
        id: {
          in: [],
        },
      };

  const keepUsers = await prisma.user.findMany({
    where: keepWhere,
    select: {
      id: true,
      email: true,
      platformRoleAssignments: {
        select: {
          role: {
            select: {
              name: true,
              systemKey: true,
            },
          },
        },
        orderBy: {
          role: {
            name: 'asc',
          },
        },
      },
    },
    orderBy: {
      email: 'asc',
    },
  });

  const keepUserIds = keepUsers.map((user) => user.id);

  if (keepUserIds.length === 0) {
    throw new Error(
      [
        'No user was selected to keep, so the reset was refused.',
        'Provide SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, and SUPER_ADMIN_NAME, or set RESET_KEEP_EMAILS.',
      ].join(' '),
    );
  }

  const [
    totalUsers,
    usersToDelete,
    organizationInvitesToDelete,
    joinRequestsToDelete,
    auditLogsToDelete,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({
      where: {
        id: {
          notIn: keepUserIds,
        },
      },
    }),
    prisma.organizationInvite.count(),
    prisma.joinRequest.count(),
    prisma.auditLog.count(),
  ]);

  return {
    database,
    dryRun,
    keepUserIds,
    keepUsers: keepUsers.map((user) => ({
      id: user.id,
      email: user.email,
      platformRoles:
        configuredSuperAdmin?.email === user.email
          ? ['env_super_admin']
          : user.platformRoleAssignments.map(
              ({ role }) => role.systemKey ?? role.name,
            ),
    })),
    counts: {
      totalUsers,
      usersToDelete,
      organizationInvitesToDelete,
      joinRequestsToDelete,
      auditLogsToDelete,
    },
  };
}

function printSummary(summary: ResetSummary): void {
  console.info(`Database: ${summary.database}`);
  console.info(`Mode: ${summary.dryRun ? 'dry run' : 'reset'}`);
  console.info('');
  console.info('Users that will be kept:');

  for (const user of summary.keepUsers) {
    console.info(
      `- ${user.email} (${user.platformRoles.join(', ') || 'no platform role'})`,
    );
  }

  console.info('');
  console.info('Cleanup plan:');
  console.info(`- Total users: ${summary.counts.totalUsers}`);
  console.info(`- Users to delete: ${summary.counts.usersToDelete}`);
  console.info(
    `- Organization invites to delete: ${summary.counts.organizationInvitesToDelete}`,
  );
  console.info(
    `- Join requests to delete: ${summary.counts.joinRequestsToDelete}`,
  );
  console.info(`- Audit logs to delete: ${summary.counts.auditLogsToDelete}`);
}

async function invalidateAccessControlCache(): Promise<boolean> {
  const redisUrl = process.env.REDIS_URL?.trim();

  if (!redisUrl) {
    return false;
  }

  const redis = new Redis(redisUrl, {
    connectTimeout: 1_000,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });

  try {
    await redis.connect();
    await redis.incr(ACCESS_CONTROL_GLOBAL_VERSION_KEY);

    return true;
  } catch (error: unknown) {
    console.warn(
      `Could not invalidate Redis access-control cache: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );

    return false;
  } finally {
    redis.disconnect();
  }
}

async function resetUsers(
  prisma: PrismaClient,
  keepUserIds: string[],
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    await transaction.organizationInviteRole.deleteMany();
    await transaction.organizationInvite.deleteMany();
    await transaction.joinRequest.deleteMany();
    await transaction.auditLog.deleteMany();
    await transaction.user.deleteMany({
      where: {
        id: {
          notIn: keepUserIds,
        },
      },
    });
    await transaction.user.updateMany({
      where: {
        id: {
          in: keepUserIds,
        },
      },
      data: {
        isVerified: true,
        isActive: true,
        deactivatedAt: null,
      },
    });
  });
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const connectionString = getConnectionString();
  const database = describeDatabase(connectionString);
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });

  try {
    if (!dryRun) {
      await ensureConfiguredSuperAdminUser(prisma);
    }

    const summary = await buildResetSummary(prisma, database, dryRun);
    printSummary(summary);

    if (dryRun) {
      console.info('');
      console.info(
        `No data changed. To reset, run with CONFIRM_RESET_USERS=${CONFIRMATION_VALUE}.`,
      );

      return;
    }

    if (process.env.CONFIRM_RESET_USERS !== CONFIRMATION_VALUE) {
      throw new Error(
        `Refusing to delete data. Set CONFIRM_RESET_USERS=${CONFIRMATION_VALUE} and run again.`,
      );
    }

    await resetUsers(prisma, summary.keepUserIds);
    const cacheInvalidated = await invalidateAccessControlCache();

    console.info('');
    console.info('Reset complete.');
    console.info(
      cacheInvalidated
        ? 'Access-control cache invalidated.'
        : 'Access-control cache was not invalidated because Redis was unavailable or not configured.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'User reset failed unexpectedly.',
  );
  process.exitCode = 1;
});
