export const PLATFORM_ROLE_KEYS = {
  superAdmin: 'super_admin',
} as const;

export const ORGANIZATION_ROLE_KEYS = {
  organizationAdmin: 'organization_admin',
  manager: 'manager',
  employee: 'employee',
} as const;

export const PLATFORM_PERMISSIONS = {
  organizationsManage: 'platform.organizations.manage',
  usersManage: 'platform.users.manage',
  documentsManage: 'platform.documents.manage',
  subscriptionsManage: 'platform.subscriptions.manage',
  aiConfigurationManage: 'platform.ai_config.manage',
  settingsManage: 'platform.settings.manage',
  analyticsView: 'platform.analytics.view',
  auditLogsView: 'platform.audit_logs.view',
} as const;

export const ORGANIZATION_PERMISSIONS = {
  documentsRead: 'documents.read',
  documentsCreate: 'documents.create',
  documentsUpdate: 'documents.update',
  documentsDelete: 'documents.delete',
  documentsExport: 'documents.export',
  documentsUpload: 'documents.upload',
  aiAccess: 'ai.access',
  billingManage: 'billing.manage',
  membersManage: 'members.manage',
  rolesManage: 'roles.manage',
  permissionsAssign: 'permissions.assign',
  queuesManage: 'queues.manage',
  analyticsView: 'analytics.view',
  promptsManage: 'prompts.manage',
  apiAccess: 'api.access',
  settingsManage: 'settings.manage',
} as const;

export const LEGACY_PERMISSIONS = {
  usersManage: 'users.manage',
  superAdminAssign: 'platform.super_admin.assign',
} as const;

export const ORGANIZATION_ROLE_ASSIGNMENT_LIMITED_SYSTEM_KEYS: ReadonlySet<string> =
  new Set([ORGANIZATION_ROLE_KEYS.manager, ORGANIZATION_ROLE_KEYS.employee]);

export const ORGANIZATION_ROLE_ASSIGNMENT_PROTECTED_PERMISSIONS: ReadonlySet<string> =
  new Set([
    ORGANIZATION_PERMISSIONS.membersManage,
    ORGANIZATION_PERMISSIONS.rolesManage,
    ORGANIZATION_PERMISSIONS.permissionsAssign,
    ORGANIZATION_PERMISSIONS.billingManage,
    ORGANIZATION_PERMISSIONS.queuesManage,
    ORGANIZATION_PERMISSIONS.promptsManage,
    ORGANIZATION_PERMISSIONS.settingsManage,
  ]);
