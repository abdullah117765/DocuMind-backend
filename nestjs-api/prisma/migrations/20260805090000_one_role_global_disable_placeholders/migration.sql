ALTER TABLE "organization_invites"
ADD COLUMN "temporary_password_hash" VARCHAR(255),
ADD COLUMN "temporary_password_expires_at" TIMESTAMP(3),
ADD COLUMN "temporary_password_used_at" TIMESTAMP(3);

-- Disable placeholder product areas that are not part of the current UI.
-- Keep the tables for backwards-compatible migrations, but remove the permissions
-- so permission-driven navigation does not expose billing, subscription, limits,
-- or empty settings pages.
UPDATE "permissions"
SET
  "is_active" = false,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "code" IN (
  'billing.manage',
  'settings.manage',
  'platform.subscriptions.manage',
  'platform.settings.manage'
);

DELETE FROM "role_permissions"
USING "permissions"
WHERE
  "role_permissions"."permission_id" = "permissions"."id"
  AND "permissions"."code" IN (
    'billing.manage',
    'settings.manage',
    'platform.subscriptions.manage',
    'platform.settings.manage'
  );

-- Super Admin is no longer a database-assigned role. It is authenticated and
-- authorized from SUPER_ADMIN_* environment variables. Remove legacy DB grants
-- so old rows cannot create a second Super Admin.
DELETE FROM "platform_user_roles"
USING "roles"
WHERE
  "platform_user_roles"."role_id" = "roles"."id"
  AND "roles"."system_key" = 'super_admin';

DELETE FROM "role_permissions"
USING "roles"
WHERE
  "role_permissions"."role_id" = "roles"."id"
  AND "roles"."system_key" = 'super_admin';

UPDATE "roles"
SET
  "name" = 'Super Admin (env only)',
  "description" = 'Legacy placeholder only. The real Super Admin is configured from environment variables and is not assigned as a database role.',
  "is_active" = false,
  "auto_grant_new_permissions" = false,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "system_key" = 'super_admin';

-- Future guardrail: one active role per user globally.
-- Existing non-Super-Admin legacy role data is not deleted here; cleanup remains
-- an explicit admin action.
CREATE OR REPLACE FUNCTION enforce_one_global_membership_role_assignment()
RETURNS trigger AS $$
DECLARE
  assigned_user_id uuid;
  membership_status "OrganizationMembershipStatus";
  existing_membership_roles integer;
  existing_platform_roles integer;
BEGIN
  SELECT "user_id", "status"
  INTO assigned_user_id, membership_status
  FROM "organization_memberships"
  WHERE "id" = NEW."membership_id"
  LIMIT 1;

  IF assigned_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF membership_status NOT IN (
    'ACTIVE'::"OrganizationMembershipStatus",
    'SUSPENDED'::"OrganizationMembershipStatus"
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
  INTO existing_membership_roles
  FROM "membership_roles"
  INNER JOIN "organization_memberships"
    ON "organization_memberships"."id" = "membership_roles"."membership_id"
  INNER JOIN "roles"
    ON "roles"."id" = "membership_roles"."role_id"
  WHERE
    "organization_memberships"."user_id" = assigned_user_id
    AND "organization_memberships"."status" IN (
      'ACTIVE'::"OrganizationMembershipStatus",
      'SUSPENDED'::"OrganizationMembershipStatus"
    )
    AND "roles"."is_active" = true
    AND NOT (
      "membership_roles"."membership_id" = NEW."membership_id"
      AND "membership_roles"."role_id" = NEW."role_id"
    );

  IF existing_membership_roles > 0 THEN
    RAISE EXCEPTION 'Only one role assignment is allowed per user globally'
      USING ERRCODE = '23505';
  END IF;

  SELECT COUNT(*)
  INTO existing_platform_roles
  FROM "platform_user_roles"
  INNER JOIN "roles"
    ON "roles"."id" = "platform_user_roles"."role_id"
  WHERE
    "platform_user_roles"."user_id" = assigned_user_id
    AND "roles"."is_active" = true;

  IF existing_platform_roles > 0 THEN
    RAISE EXCEPTION 'A user with a platform role cannot receive an organization role'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_one_global_membership_role_assignment_trigger
ON "membership_roles";

CREATE TRIGGER enforce_one_global_membership_role_assignment_trigger
BEFORE INSERT OR UPDATE ON "membership_roles"
FOR EACH ROW
EXECUTE FUNCTION enforce_one_global_membership_role_assignment();

CREATE OR REPLACE FUNCTION enforce_one_global_platform_role_assignment()
RETURNS trigger AS $$
DECLARE
  existing_platform_roles integer;
  existing_membership_roles integer;
BEGIN
  SELECT COUNT(*)
  INTO existing_platform_roles
  FROM "platform_user_roles"
  INNER JOIN "roles"
    ON "roles"."id" = "platform_user_roles"."role_id"
  WHERE
    "platform_user_roles"."user_id" = NEW."user_id"
    AND "roles"."is_active" = true
    AND NOT (
      "platform_user_roles"."user_id" = NEW."user_id"
      AND "platform_user_roles"."role_id" = NEW."role_id"
    );

  IF existing_platform_roles > 0 THEN
    RAISE EXCEPTION 'Only one platform role assignment is allowed per user'
      USING ERRCODE = '23505';
  END IF;

  SELECT COUNT(*)
  INTO existing_membership_roles
  FROM "membership_roles"
  INNER JOIN "organization_memberships"
    ON "organization_memberships"."id" = "membership_roles"."membership_id"
  INNER JOIN "roles"
    ON "roles"."id" = "membership_roles"."role_id"
  WHERE
    "organization_memberships"."user_id" = NEW."user_id"
    AND "organization_memberships"."status" IN (
      'ACTIVE'::"OrganizationMembershipStatus",
      'SUSPENDED'::"OrganizationMembershipStatus"
    )
    AND "roles"."is_active" = true;

  IF existing_membership_roles > 0 THEN
    RAISE EXCEPTION 'A user with an organization role cannot receive a platform role'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_one_global_platform_role_assignment_trigger
ON "platform_user_roles";

CREATE TRIGGER enforce_one_global_platform_role_assignment_trigger
BEFORE INSERT OR UPDATE ON "platform_user_roles"
FOR EACH ROW
EXECUTE FUNCTION enforce_one_global_platform_role_assignment();

CREATE OR REPLACE FUNCTION enforce_one_global_role_on_membership_activation()
RETURNS trigger AS $$
DECLARE
  own_membership_roles integer;
  other_membership_roles integer;
  platform_roles integer;
BEGIN
  IF NEW."status" NOT IN (
    'ACTIVE'::"OrganizationMembershipStatus",
    'SUSPENDED'::"OrganizationMembershipStatus"
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)
  INTO own_membership_roles
  FROM "membership_roles"
  INNER JOIN "roles"
    ON "roles"."id" = "membership_roles"."role_id"
  WHERE
    "membership_roles"."membership_id" = NEW."id"
    AND "roles"."is_active" = true;

  IF own_membership_roles = 0 THEN
    RETURN NEW;
  END IF;

  IF own_membership_roles > 1 THEN
    RAISE EXCEPTION 'Only one role assignment is allowed per user globally'
      USING ERRCODE = '23505';
  END IF;

  SELECT COUNT(*)
  INTO other_membership_roles
  FROM "membership_roles"
  INNER JOIN "organization_memberships"
    ON "organization_memberships"."id" = "membership_roles"."membership_id"
  INNER JOIN "roles"
    ON "roles"."id" = "membership_roles"."role_id"
  WHERE
    "organization_memberships"."user_id" = NEW."user_id"
    AND "organization_memberships"."id" <> NEW."id"
    AND "organization_memberships"."status" IN (
      'ACTIVE'::"OrganizationMembershipStatus",
      'SUSPENDED'::"OrganizationMembershipStatus"
    )
    AND "roles"."is_active" = true;

  SELECT COUNT(*)
  INTO platform_roles
  FROM "platform_user_roles"
  INNER JOIN "roles"
    ON "roles"."id" = "platform_user_roles"."role_id"
  WHERE
    "platform_user_roles"."user_id" = NEW."user_id"
    AND "roles"."is_active" = true;

  IF other_membership_roles > 0 OR platform_roles > 0 THEN
    RAISE EXCEPTION 'Only one role assignment is allowed per user globally'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_one_global_role_on_membership_activation_trigger
ON "organization_memberships";

CREATE TRIGGER enforce_one_global_role_on_membership_activation_trigger
BEFORE INSERT OR UPDATE OF "status" ON "organization_memberships"
FOR EACH ROW
EXECUTE FUNCTION enforce_one_global_role_on_membership_activation();
