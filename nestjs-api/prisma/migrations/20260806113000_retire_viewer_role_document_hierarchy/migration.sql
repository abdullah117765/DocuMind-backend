-- Retire the Viewer system role. Existing Viewer memberships and pending
-- invite role assignments are moved to Employee so users are not stranded with
-- an inactive role after the role disappears from the UI.

WITH viewer_role AS (
  SELECT "id"
  FROM "roles"
  WHERE "system_key" = 'viewer'
  LIMIT 1
),
employee_role AS (
  SELECT "id"
  FROM "roles"
  WHERE "system_key" = 'employee'
  LIMIT 1
)
INSERT INTO "membership_roles" (
  "membership_id",
  "role_id",
  "assigned_by_user_id",
  "source",
  "assigned_at"
)
SELECT
  "membership_roles"."membership_id",
  employee_role."id",
  "membership_roles"."assigned_by_user_id",
  "membership_roles"."source",
  CURRENT_TIMESTAMP
FROM "membership_roles"
CROSS JOIN viewer_role
CROSS JOIN employee_role
WHERE "membership_roles"."role_id" = viewer_role."id"
ON CONFLICT DO NOTHING;

WITH viewer_role AS (
  SELECT "id"
  FROM "roles"
  WHERE "system_key" = 'viewer'
  LIMIT 1
)
DELETE FROM "membership_roles"
USING viewer_role
WHERE "membership_roles"."role_id" = viewer_role."id";

WITH viewer_role AS (
  SELECT "id"
  FROM "roles"
  WHERE "system_key" = 'viewer'
  LIMIT 1
),
employee_role AS (
  SELECT "id"
  FROM "roles"
  WHERE "system_key" = 'employee'
  LIMIT 1
)
INSERT INTO "organization_invite_roles" (
  "invite_id",
  "role_id",
  "assigned_at"
)
SELECT
  "organization_invite_roles"."invite_id",
  employee_role."id",
  CURRENT_TIMESTAMP
FROM "organization_invite_roles"
CROSS JOIN viewer_role
CROSS JOIN employee_role
WHERE "organization_invite_roles"."role_id" = viewer_role."id"
ON CONFLICT DO NOTHING;

WITH viewer_role AS (
  SELECT "id"
  FROM "roles"
  WHERE "system_key" = 'viewer'
  LIMIT 1
)
DELETE FROM "organization_invite_roles"
USING viewer_role
WHERE "organization_invite_roles"."role_id" = viewer_role."id";

UPDATE "roles"
SET
  "is_active" = false,
  "description" = 'Retired role. Existing Viewer assignments were migrated to Employee.',
  "updated_at" = CURRENT_TIMESTAMP
WHERE "system_key" = 'viewer';

