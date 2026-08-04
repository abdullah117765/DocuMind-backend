CREATE EXTENSION IF NOT EXISTS pgcrypto;

INSERT INTO "permissions" (
  "id",
  "code",
  "name",
  "description",
  "category",
  "scope",
  "is_system",
  "is_active",
  "created_at",
  "updated_at"
)
VALUES
  (gen_random_uuid(), 'members.manage', 'Member Management', 'Create, invite, update, deactivate, and remove organization members.', 'Administration', 'ORGANIZATION', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'roles.manage', 'Role Management', 'Create, update, deactivate, and assign organization roles.', 'Administration', 'ORGANIZATION', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'permissions.assign', 'Permission Assignment', 'Assign organization permissions to custom roles.', 'Administration', 'ORGANIZATION', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'settings.manage', 'Organization Settings', 'Update organization profile and tenant settings.', 'Administration', 'ORGANIZATION', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'platform.subscriptions.manage', 'Platform Subscriptions', 'Manage platform subscription plans and tenant plan state.', 'Platform', 'PLATFORM', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'platform.ai_config.manage', 'Global AI Configuration', 'Manage global AI configuration and provider settings.', 'Platform', 'PLATFORM', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'platform.settings.manage', 'System Settings', 'Manage platform-wide system settings.', 'Platform', 'PLATFORM', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'platform.analytics.view', 'Platform Analytics', 'View platform-wide analytics.', 'Platform', 'PLATFORM', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE
SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "category" = EXCLUDED."category",
  "scope" = EXCLUDED."scope",
  "is_system" = true,
  "is_active" = true,
  "updated_at" = CURRENT_TIMESTAMP;

UPDATE "permissions"
SET
  "name" = 'User Management (legacy)',
  "description" = 'Legacy broad organization user-management permission. Replaced by members.manage, roles.manage, and permissions.assign.',
  "is_system" = true,
  "is_active" = false,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'users.manage';

UPDATE "permissions"
SET
  "name" = 'Assign Super Admin (legacy)',
  "description" = 'Legacy Super Admin assignment permission. Super Admin is now backend/database-only.',
  "is_system" = true,
  "is_active" = false,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'platform.super_admin.assign';

UPDATE "roles"
SET
  "description" = 'Full access across the platform and every organization.',
  "scope" = 'PLATFORM',
  "is_system" = true,
  "is_active" = true,
  "auto_grant_new_permissions" = true,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "system_key" = 'super_admin';

UPDATE "roles"
SET
  "description" = 'Full administrative access within an organization.',
  "scope" = 'ORGANIZATION',
  "is_system" = true,
  "is_active" = true,
  "auto_grant_new_permissions" = true,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "system_key" = 'organization_admin';

UPDATE "roles"
SET
  "description" = 'Manage assigned document workflows and use team analytics within one organization.',
  "scope" = 'ORGANIZATION',
  "is_system" = true,
  "is_active" = true,
  "auto_grant_new_permissions" = false,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "system_key" = 'manager';

UPDATE "roles"
SET
  "description" = 'Create, update, upload, and process assigned documents.',
  "scope" = 'ORGANIZATION',
  "is_system" = true,
  "is_active" = true,
  "auto_grant_new_permissions" = false,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "system_key" = 'employee';

UPDATE "roles"
SET
  "description" = 'Read documents and shared organization information.',
  "scope" = 'ORGANIZATION',
  "is_system" = true,
  "is_active" = true,
  "auto_grant_new_permissions" = false,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "system_key" = 'viewer';

WITH target_role_permissions ("role_system_key", "permission_code") AS (
  VALUES
    ('super_admin', 'documents.read'),
    ('super_admin', 'documents.create'),
    ('super_admin', 'documents.update'),
    ('super_admin', 'documents.delete'),
    ('super_admin', 'documents.export'),
    ('super_admin', 'documents.upload'),
    ('super_admin', 'ai.access'),
    ('super_admin', 'billing.manage'),
    ('super_admin', 'members.manage'),
    ('super_admin', 'roles.manage'),
    ('super_admin', 'permissions.assign'),
    ('super_admin', 'settings.manage'),
    ('super_admin', 'queues.manage'),
    ('super_admin', 'analytics.view'),
    ('super_admin', 'prompts.manage'),
    ('super_admin', 'api.access'),
    ('super_admin', 'platform.organizations.manage'),
    ('super_admin', 'platform.users.manage'),
    ('super_admin', 'platform.subscriptions.manage'),
    ('super_admin', 'platform.ai_config.manage'),
    ('super_admin', 'platform.settings.manage'),
    ('super_admin', 'platform.analytics.view'),
    ('super_admin', 'platform.audit_logs.view'),
    ('organization_admin', 'documents.read'),
    ('organization_admin', 'documents.create'),
    ('organization_admin', 'documents.update'),
    ('organization_admin', 'documents.delete'),
    ('organization_admin', 'documents.export'),
    ('organization_admin', 'documents.upload'),
    ('organization_admin', 'ai.access'),
    ('organization_admin', 'billing.manage'),
    ('organization_admin', 'members.manage'),
    ('organization_admin', 'roles.manage'),
    ('organization_admin', 'permissions.assign'),
    ('organization_admin', 'settings.manage'),
    ('organization_admin', 'queues.manage'),
    ('organization_admin', 'analytics.view'),
    ('organization_admin', 'prompts.manage'),
    ('organization_admin', 'api.access'),
    ('manager', 'documents.read'),
    ('manager', 'documents.create'),
    ('manager', 'documents.update'),
    ('manager', 'documents.upload'),
    ('manager', 'ai.access'),
    ('manager', 'analytics.view'),
    ('employee', 'documents.read'),
    ('employee', 'documents.create'),
    ('employee', 'documents.update'),
    ('employee', 'documents.upload'),
    ('employee', 'ai.access'),
    ('viewer', 'documents.read')
)
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "roles"."id", "permissions"."id"
FROM target_role_permissions
JOIN "roles" ON "roles"."system_key" = target_role_permissions."role_system_key"
JOIN "permissions" ON "permissions"."code" = target_role_permissions."permission_code"
ON CONFLICT ("role_id", "permission_id") DO NOTHING;

WITH target_role_permissions ("role_system_key", "permission_code") AS (
  VALUES
    ('super_admin', 'documents.read'),
    ('super_admin', 'documents.create'),
    ('super_admin', 'documents.update'),
    ('super_admin', 'documents.delete'),
    ('super_admin', 'documents.export'),
    ('super_admin', 'documents.upload'),
    ('super_admin', 'ai.access'),
    ('super_admin', 'billing.manage'),
    ('super_admin', 'members.manage'),
    ('super_admin', 'roles.manage'),
    ('super_admin', 'permissions.assign'),
    ('super_admin', 'settings.manage'),
    ('super_admin', 'queues.manage'),
    ('super_admin', 'analytics.view'),
    ('super_admin', 'prompts.manage'),
    ('super_admin', 'api.access'),
    ('super_admin', 'platform.organizations.manage'),
    ('super_admin', 'platform.users.manage'),
    ('super_admin', 'platform.subscriptions.manage'),
    ('super_admin', 'platform.ai_config.manage'),
    ('super_admin', 'platform.settings.manage'),
    ('super_admin', 'platform.analytics.view'),
    ('super_admin', 'platform.audit_logs.view'),
    ('organization_admin', 'documents.read'),
    ('organization_admin', 'documents.create'),
    ('organization_admin', 'documents.update'),
    ('organization_admin', 'documents.delete'),
    ('organization_admin', 'documents.export'),
    ('organization_admin', 'documents.upload'),
    ('organization_admin', 'ai.access'),
    ('organization_admin', 'billing.manage'),
    ('organization_admin', 'members.manage'),
    ('organization_admin', 'roles.manage'),
    ('organization_admin', 'permissions.assign'),
    ('organization_admin', 'settings.manage'),
    ('organization_admin', 'queues.manage'),
    ('organization_admin', 'analytics.view'),
    ('organization_admin', 'prompts.manage'),
    ('organization_admin', 'api.access'),
    ('manager', 'documents.read'),
    ('manager', 'documents.create'),
    ('manager', 'documents.update'),
    ('manager', 'documents.upload'),
    ('manager', 'ai.access'),
    ('manager', 'analytics.view'),
    ('employee', 'documents.read'),
    ('employee', 'documents.create'),
    ('employee', 'documents.update'),
    ('employee', 'documents.upload'),
    ('employee', 'ai.access'),
    ('viewer', 'documents.read')
)
DELETE FROM "role_permissions"
USING "roles", "permissions"
WHERE
  "role_permissions"."role_id" = "roles"."id"
  AND "role_permissions"."permission_id" = "permissions"."id"
  AND "roles"."system_key" IN (
    'super_admin',
    'organization_admin',
    'manager',
    'employee',
    'viewer'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM target_role_permissions
    WHERE
      target_role_permissions."role_system_key" = "roles"."system_key"
      AND target_role_permissions."permission_code" = "permissions"."code"
  );

CREATE OR REPLACE FUNCTION enforce_single_super_admin_platform_role()
RETURNS trigger AS $$
DECLARE
  super_admin_role_id uuid;
  existing_assignments integer;
BEGIN
  SELECT "id"
  INTO super_admin_role_id
  FROM "roles"
  WHERE "system_key" = 'super_admin' AND "scope" = 'PLATFORM'
  LIMIT 1;

  IF super_admin_role_id IS NULL OR NEW."role_id" <> super_admin_role_id THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
  INTO existing_assignments
  FROM "platform_user_roles"
  WHERE
    "role_id" = super_admin_role_id
    AND NOT (
      "user_id" = NEW."user_id"
      AND "role_id" = NEW."role_id"
    );

  IF existing_assignments > 0 THEN
    RAISE EXCEPTION 'Only one Super Admin role assignment is allowed'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_single_super_admin_platform_role_trigger ON "platform_user_roles";

CREATE TRIGGER enforce_single_super_admin_platform_role_trigger
BEFORE INSERT OR UPDATE ON "platform_user_roles"
FOR EACH ROW
EXECUTE FUNCTION enforce_single_super_admin_platform_role();
