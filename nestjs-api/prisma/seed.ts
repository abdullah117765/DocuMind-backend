import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  AccessScope,
  PrismaClient,
  type Prisma,
} from '../src/generated/prisma/client';
import {
  LEGACY_PERMISSIONS,
  ORGANIZATION_PERMISSIONS,
  PLATFORM_PERMISSIONS,
} from '../src/modules/access-control/rbac.constants';

type SeedPermission = Omit<Prisma.PermissionCreateInput, 'roles'>;

const permissions: readonly SeedPermission[] = [
  {
    code: ORGANIZATION_PERMISSIONS.documentsRead,
    name: 'Read',
    description: 'View documents and their processed data.',
    category: 'Documents',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: ORGANIZATION_PERMISSIONS.documentsCreate,
    name: 'Create',
    description: 'Create documents and related records.',
    category: 'Documents',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: ORGANIZATION_PERMISSIONS.documentsUpdate,
    name: 'Update',
    description: 'Update documents and related records.',
    category: 'Documents',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: ORGANIZATION_PERMISSIONS.documentsDelete,
    name: 'Delete',
    description: 'Delete documents and related records.',
    category: 'Documents',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: ORGANIZATION_PERMISSIONS.documentsExport,
    name: 'Export',
    description: 'Export organization document data.',
    category: 'Documents',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: ORGANIZATION_PERMISSIONS.documentsUpload,
    name: 'Upload',
    description: 'Upload documents for processing.',
    category: 'Documents',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: ORGANIZATION_PERMISSIONS.aiAccess,
    name: 'AI Access',
    description: 'Use AI-powered document features.',
    category: 'AI',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: ORGANIZATION_PERMISSIONS.billingManage,
    name: 'Billing',
    description: 'View and manage organization billing.',
    category: 'Administration',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: ORGANIZATION_PERMISSIONS.membersManage,
    name: 'Member Management',
    description: 'Create, invite, update, deactivate, and remove organization members.',
    category: 'Administration',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: ORGANIZATION_PERMISSIONS.rolesManage,
    name: 'Role Management',
    description: 'Create, update, deactivate, and assign organization roles.',
    category: 'Administration',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: ORGANIZATION_PERMISSIONS.permissionsAssign,
    name: 'Permission Assignment',
    description: 'Assign organization permissions to custom roles.',
    category: 'Administration',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: ORGANIZATION_PERMISSIONS.settingsManage,
    name: 'Organization Settings',
    description: 'Update organization profile and tenant settings.',
    category: 'Administration',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: LEGACY_PERMISSIONS.usersManage,
    name: 'User Management (legacy)',
    description:
      'Legacy broad organization user-management permission. Replaced by members.manage, roles.manage, and permissions.assign.',
    category: 'Administration',
    scope: AccessScope.ORGANIZATION,
    isActive: false,
  },
  {
    code: ORGANIZATION_PERMISSIONS.queuesManage,
    name: 'Queue Management',
    description: 'Manage document-processing queues.',
    category: 'Operations',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: ORGANIZATION_PERMISSIONS.analyticsView,
    name: 'Analytics',
    description: 'View organization analytics.',
    category: 'Analytics',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: ORGANIZATION_PERMISSIONS.promptsManage,
    name: 'Prompt Management',
    description: 'Create and manage organization AI prompts.',
    category: 'AI',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: ORGANIZATION_PERMISSIONS.apiAccess,
    name: 'API Access',
    description: 'Use organization API integrations.',
    category: 'Integrations',
    scope: AccessScope.ORGANIZATION,
  },
  {
    code: PLATFORM_PERMISSIONS.organizationsManage,
    name: 'Organizations',
    description: 'Create and manage tenant organizations.',
    category: 'Platform',
    scope: AccessScope.PLATFORM,
  },
  {
    code: LEGACY_PERMISSIONS.superAdminAssign,
    name: 'Assign Super Admin (legacy)',
    description:
      'Legacy Super Admin assignment permission. Super Admin is now backend/database-only.',
    category: 'Platform',
    scope: AccessScope.PLATFORM,
    isActive: false,
  },
  {
    code: PLATFORM_PERMISSIONS.usersManage,
    name: 'Platform Users',
    description: 'Search, create, deactivate, and manage platform users.',
    category: 'Platform',
    scope: AccessScope.PLATFORM,
  },
  {
    code: PLATFORM_PERMISSIONS.subscriptionsManage,
    name: 'Platform Subscriptions',
    description: 'Manage platform subscription plans and tenant plan state.',
    category: 'Platform',
    scope: AccessScope.PLATFORM,
  },
  {
    code: PLATFORM_PERMISSIONS.aiConfigurationManage,
    name: 'Global AI Configuration',
    description: 'Manage global AI configuration and provider settings.',
    category: 'Platform',
    scope: AccessScope.PLATFORM,
  },
  {
    code: PLATFORM_PERMISSIONS.settingsManage,
    name: 'System Settings',
    description: 'Manage platform-wide system settings.',
    category: 'Platform',
    scope: AccessScope.PLATFORM,
  },
  {
    code: PLATFORM_PERMISSIONS.analyticsView,
    name: 'Platform Analytics',
    description: 'View platform-wide analytics.',
    category: 'Platform',
    scope: AccessScope.PLATFORM,
  },
  {
    code: PLATFORM_PERMISSIONS.auditLogsView,
    name: 'Audit Logs',
    description: 'View platform-wide audit logs.',
    category: 'Platform',
    scope: AccessScope.PLATFORM,
  },
];

const roleDefinitions = [
  {
    systemKey: 'super_admin',
    name: 'Super Admin',
    normalizedName: 'super admin',
    description: 'Full access across the platform and every organization.',
    scope: AccessScope.PLATFORM,
    autoGrantNewPermissions: true,
    permissionCodes: permissions
      .filter(({ isActive }) => isActive !== false)
      .map(({ code }) => code),
  },
  {
    systemKey: 'organization_admin',
    name: 'Organization Admin',
    normalizedName: 'organization admin',
    description: 'Full administrative access within an organization.',
    scope: AccessScope.ORGANIZATION,
    autoGrantNewPermissions: true,
    permissionCodes: permissions
      .filter(
        ({ scope, isActive }) =>
          scope === AccessScope.ORGANIZATION && isActive !== false,
      )
      .map(({ code }) => code),
  },
  {
    systemKey: 'manager',
    name: 'Manager',
    normalizedName: 'manager',
    description:
      'Manage assigned document workflows and use team analytics within one organization.',
    scope: AccessScope.ORGANIZATION,
    autoGrantNewPermissions: false,
    permissionCodes: [
      ORGANIZATION_PERMISSIONS.documentsRead,
      ORGANIZATION_PERMISSIONS.documentsCreate,
      ORGANIZATION_PERMISSIONS.documentsUpdate,
      ORGANIZATION_PERMISSIONS.documentsUpload,
      ORGANIZATION_PERMISSIONS.aiAccess,
      ORGANIZATION_PERMISSIONS.analyticsView,
    ],
  },
  {
    systemKey: 'employee',
    name: 'Employee',
    normalizedName: 'employee',
    description: 'Create, update, upload, and process assigned documents.',
    scope: AccessScope.ORGANIZATION,
    autoGrantNewPermissions: false,
    permissionCodes: [
      ORGANIZATION_PERMISSIONS.documentsRead,
      ORGANIZATION_PERMISSIONS.documentsCreate,
      ORGANIZATION_PERMISSIONS.documentsUpdate,
      ORGANIZATION_PERMISSIONS.documentsUpload,
      ORGANIZATION_PERMISSIONS.aiAccess,
    ],
  },
  {
    systemKey: 'viewer',
    name: 'Viewer',
    normalizedName: 'viewer',
    description: 'Read documents and shared organization information.',
    scope: AccessScope.ORGANIZATION,
    autoGrantNewPermissions: false,
    permissionCodes: [ORGANIZATION_PERMISSIONS.documentsRead],
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
        const isActive = permission.isActive ?? true;
        const persistedPermission = await transaction.permission.upsert({
          where: { code: permission.code },
          create: {
            ...permission,
            isSystem: true,
            isActive,
          },
          update: {
            name: permission.name,
            description: permission.description,
            category: permission.category,
            scope: permission.scope,
            isSystem: true,
            isActive,
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

        await transaction.rolePermission.deleteMany({
          where: {
            roleId: role.id,
            permission: {
              is: {
                code: {
                  notIn: [...roleDefinition.permissionCodes],
                },
              },
            },
          },
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
