import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  AccessScope,
  PrismaClient,
  type Prisma,
} from '../src/generated/prisma/client';

const permissions = [
  {
    code: 'documents.read',
    name: 'Read',
    description: 'View documents and their processed data.',
    category: 'Documents',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: 'documents.create',
    name: 'Create',
    description: 'Create documents and related records.',
    category: 'Documents',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: 'documents.update',
    name: 'Update',
    description: 'Update documents and related records.',
    category: 'Documents',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: 'documents.delete',
    name: 'Delete',
    description: 'Delete documents and related records.',
    category: 'Documents',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: 'documents.export',
    name: 'Export',
    description: 'Export organization document data.',
    category: 'Documents',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: 'documents.upload',
    name: 'Upload',
    description: 'Upload documents for processing.',
    category: 'Documents',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: 'ai.access',
    name: 'AI Access',
    description: 'Use AI-powered document features.',
    category: 'AI',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: 'billing.manage',
    name: 'Billing',
    description: 'View and manage organization billing.',
    category: 'Administration',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: 'users.manage',
    name: 'User Management',
    description: 'Manage organization members and their roles.',
    category: 'Administration',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: 'queues.manage',
    name: 'Queue Management',
    description: 'Manage document-processing queues.',
    category: 'Operations',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: 'analytics.view',
    name: 'Analytics',
    description: 'View organization analytics.',
    category: 'Analytics',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: 'prompts.manage',
    name: 'Prompt Management',
    description: 'Create and manage organization AI prompts.',
    category: 'AI',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: 'api.access',
    name: 'API Access',
    description: 'Use organization API integrations.',
    category: 'Integrations',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: 'platform.organizations.manage',
    name: 'Organizations',
    description: 'Create and manage tenant organizations.',
    category: 'Platform',
    scope: AccessScope.PLATFORM,
  },
  {
    code: 'platform.super_admin.assign',
    name: 'Assign Super Admin',
    description: 'Assign or remove platform Super Admin roles.',
    category: 'Platform',
    scope: AccessScope.PLATFORM,
  },
  {
    code: 'platform.users.manage',
    name: 'Platform Users',
    description: 'Search, create, deactivate, and manage platform users.',
    category: 'Platform',
    scope: AccessScope.PLATFORM,
  },
  {
    code: 'platform.audit_logs.view',
    name: 'Audit Logs',
    description: 'View platform-wide audit logs.',
    category: 'Platform',
    scope: AccessScope.PLATFORM,
  },
] as const satisfies ReadonlyArray<Omit<Prisma.PermissionCreateInput, 'roles'>>;

const roleDefinitions = [
  {
    systemKey: 'super_admin',
    name: 'Super Admin',
    normalizedName: 'super admin',
    description: 'Full access across the platform and every organization.',
    scope: AccessScope.PLATFORM,
    autoGrantNewPermissions: true,
    permissionCodes: permissions.map(({ code }) => code),
  },
  {
    systemKey: 'organization_admin',
    name: 'Organization Admin',
    normalizedName: 'organization admin',
    description: 'Full administrative access within an organization.',
    scope: AccessScope.ORGANIZATION,
    autoGrantNewPermissions: true,
    permissionCodes: permissions
      .filter(({ scope }) => scope === AccessScope.ORGANIZATION)
      .map(({ code }) => code),
  },
  {
    systemKey: 'manager',
    name: 'Manager',
    normalizedName: 'manager',
    description: 'Manage document operations, queues, analytics, and prompts.',
    scope: AccessScope.ORGANIZATION,
    autoGrantNewPermissions: false,
    permissionCodes: [
      'documents.read',
      'documents.create',
      'documents.update',
      'documents.delete',
      'documents.export',
      'documents.upload',
      'ai.access',
      'queues.manage',
      'analytics.view',
      'prompts.manage',
    ],
  },
  {
    systemKey: 'employee',
    name: 'Employee',
    normalizedName: 'employee',
    description: 'Create, update, upload, export, and process documents.',
    scope: AccessScope.ORGANIZATION,
    autoGrantNewPermissions: false,
    permissionCodes: [
      'documents.read',
      'documents.create',
      'documents.update',
      'documents.export',
      'documents.upload',
      'ai.access',
    ],
  },
  {
    systemKey: 'viewer',
    name: 'Viewer',
    normalizedName: 'viewer',
    description: 'Read documents and view organization analytics.',
    scope: AccessScope.ORGANIZATION,
    autoGrantNewPermissions: false,
    permissionCodes: ['documents.read', 'analytics.view'],
  },
] as const;

function getConnectionString(): string {
  const connectionString = process.env.DATABASE_URL?.trim();

  if (!connectionString) {
    throw new Error('DATABASE_URL is required to seed access-control data.');
  }

  return connectionString;
}

async function seed(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: getConnectionString() }),
  });

  try {
    await prisma.$transaction(async (transaction) => {
      const permissionIds = new Map<string, string>();

      for (const permission of permissions) {
        const persistedPermission = await transaction.permission.upsert({
          where: { code: permission.code },
          create: {
            ...permission,
            isSystem: true,
            isActive: true,
          },
          update: {
            name: permission.name,
            description: permission.description,
            category: permission.category,
            scope: permission.scope,
            isSystem: true,
            isActive: true,
          },
          select: { id: true },
        });

        permissionIds.set(permission.code, persistedPermission.id);
      }

      for (const roleDefinition of roleDefinitions) {
        const role = await transaction.role.upsert({
          where: { systemKey: roleDefinition.systemKey },
          create: {
            systemKey: roleDefinition.systemKey,
            name: roleDefinition.name,
            normalizedName: roleDefinition.normalizedName,
            description: roleDefinition.description,
            scope: roleDefinition.scope,
            isSystem: true,
            isActive: true,
            autoGrantNewPermissions: roleDefinition.autoGrantNewPermissions,
          },
          update: {
            name: roleDefinition.name,
            normalizedName: roleDefinition.normalizedName,
            description: roleDefinition.description,
            scope: roleDefinition.scope,
            isSystem: true,
            isActive: true,
            autoGrantNewPermissions: roleDefinition.autoGrantNewPermissions,
          },
          select: { id: true },
        });

        await transaction.rolePermission.createMany({
          data: roleDefinition.permissionCodes.map((permissionCode) => {
            const permissionId = permissionIds.get(permissionCode);

            if (!permissionId) {
              throw new Error(
                `Permission ${permissionCode} was not persisted before role seeding.`,
              );
            }

            return {
              roleId: role.id,
              permissionId,
            };
          }),
          skipDuplicates: true,
        });
      }
    });

    console.info(
      `Seeded ${permissions.length} permissions and ${roleDefinitions.length} default roles.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void seed().catch((error: unknown) => {
  console.error('Access-control seed failed.', error);
  process.exitCode = 1;
});
