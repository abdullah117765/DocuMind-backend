-- Super Admin is a platform-level operator, not a tenant member.
-- Remove historical organization memberships that were automatically created
-- for users holding the platform Super Admin role.
DELETE FROM membership_roles
WHERE membership_id IN (
  SELECT organization_memberships.id
  FROM organization_memberships
  INNER JOIN platform_user_roles
    ON platform_user_roles.user_id = organization_memberships.user_id
  INNER JOIN roles
    ON roles.id = platform_user_roles.role_id
  WHERE roles.system_key = 'super_admin'
    AND roles.scope = 'PLATFORM'
);

DELETE FROM organization_memberships
WHERE id IN (
  SELECT organization_memberships.id
  FROM organization_memberships
  INNER JOIN platform_user_roles
    ON platform_user_roles.user_id = organization_memberships.user_id
  INNER JOIN roles
    ON roles.id = platform_user_roles.role_id
  WHERE roles.system_key = 'super_admin'
    AND roles.scope = 'PLATFORM'
);
