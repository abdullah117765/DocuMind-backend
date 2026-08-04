import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcrypt';
import Redis from 'ioredis';
import {
  Prisma,
  PrismaClient,
  RoleAssignmentSource,
} from '../src/generated/prisma/client';

const CONFIRMATION_VALUE = 'RESET_TEST_USERS';
const SUPER_ADMIN_SYSTEM_KEY = 'super_admin';
const ACCESS_CONTROL_GLOBAL_VERSION_KEY = 'access-control:v1:version:global';
const PASSWORD_HASH_ROUNDS = 12;

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

function getBootstrapSuperAdmin():
  | {
      email: string;
      password: string;
    }
  | null {
  const email = process.env.RESET_SUPER_ADMIN_EMAIL?.trim();
  const password = process.env.RESET_SUPER_ADMIN_PASSWORD;

  if (!email && !password) {
    return null;
  }

  if (!email || !password) {
    throw new Error(
      'Set both RESET_SUPER_ADMIN_EMAIL and RESET_SUPER_ADMIN_PASSWORD, or set neither.',
    );
  }

  if (password.length < 8) {
    throw new Error('RESET_SUPER_ADMIN_PASSWORD must be at least 8 characters.');
  }

  return {
    email: normalizeEmail(email),
    password,
  };
}

async function ensureBootstrapSuperAdmin(
  prisma: PrismaClient,
): Promise<string | null> {
  const bootstrap = getBootstrapSuperAdmin();

  if (!bootstrap) {
    return null;
  }

  const superAdminRole = await prisma.role.findUnique({
    where: { systemKey: SUPER_ADMIN_SYSTEM_KEY },
    select: { id: true },
  });

  if (!superAdminRole) {
    throw new Error(
      'Super Admin role does not exist. Run `npm run db:seed` before resetting users.',
    );
  }

  const passwordHash = await hash(bootstrap.password, PASSWORD_HASH_ROUNDS);

  const user = await prisma.user.upsert({
    where: { email: bootstrap.email },
    create: {
      email: bootstrap.email,
      passwordHash,
      isVerified: true,
      isActive: true,
      platformRoleAssignments: {
        create: {
          roleId: superAdminRole.id,
          source: RoleAssignmentSource.BOOTSTRAP,
        },
      },
    },
    update: {
      passwordHash,
      isVerified: true,
      isActive: true,
      deactivatedAt: null,
    },
    select: { id: true },
  });

  await prisma.platformUserRole.upsert({
    where: {
      userId_roleId: {
        userId: user.id,
        roleId: superAdminRole.id,
      },
    },
    create: {
      userId: user.id,
      roleId: superAdminRole.id,
      source: RoleAssignmentSource.BOOTSTRAP,
    },
    update: {
      source: RoleAssignmentSource.BOOTSTRAP,
    },
  });

  return user.id;
}

async function buildResetSummary(
  prisma: PrismaClient,
  database: string,
  dryRun: boolean,
): Promise<ResetSummary & { keepUserIds: string[] }> {
  const keepEmails = getKeepEmails();
  const keepWhere: Prisma.UserWhereInput = {
    OR: [
      {
        platformRoleAssignments: {
          some: {
            role: {
              is: {
                systemKey: SUPER_ADMIN_SYSTEM_KEY,
              },
            },
          },
        },
      },
      ...(keepEmails.length > 0
        ? [
            {
              email: {
                in: keepEmails,
              },
            },
          ]
        : []),
    ],
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
        'No Super Admin user was found, so the reset was refused.',
        'Run `npm run db:seed`, then create/assign a Super Admin, or provide RESET_SUPER_ADMIN_EMAIL and RESET_SUPER_ADMIN_PASSWORD.',
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
      platformRoles: user.platformRoleAssignments.map(
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
    await ensureBootstrapSuperAdmin(prisma);

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
