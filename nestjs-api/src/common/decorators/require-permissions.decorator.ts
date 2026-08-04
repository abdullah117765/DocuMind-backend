import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { AccessScope } from '../../generated/prisma/client';
import {
  PERMISSION_REQUIREMENT_METADATA,
  PermissionMatch,
  PermissionRequirement,
  PermissionRequirementOptions,
} from '../../modules/access-control/permission-requirement';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PlatformSuperAdminGuard } from '../guards/platform-super-admin.guard';
import { PermissionsGuard } from '../guards/permissions.guard';

function normalizePermissionCodes(permissionCodes: string[]): string[] {
  const normalizedCodes = [
    ...new Set(permissionCodes.map((code) => code.trim()).filter(Boolean)),
  ];

  if (normalizedCodes.length === 0) {
    throw new TypeError('At least one permission code is required');
  }

  return normalizedCodes;
}

export function RequirePermissions(
  options: PermissionRequirementOptions,
  ...permissionCodes: string[]
): MethodDecorator & ClassDecorator {
  const requirement: PermissionRequirement = {
    scope: options.scope,
    match: options.match ?? PermissionMatch.ALL,
    permissionCodes: normalizePermissionCodes(permissionCodes),
    ...(options.scope === 'ORGANIZATION'
      ? {
          organizationIdParam:
            options.organizationIdParam?.trim() || 'organizationId',
        }
      : {}),
  };

  return applyDecorators(
    SetMetadata(PERMISSION_REQUIREMENT_METADATA, requirement),
    UseGuards(JwtAuthGuard, PermissionsGuard),
  );
}

export function RequirePlatformPermissions(
  ...permissionCodes: string[]
): MethodDecorator & ClassDecorator {
  return RequirePermissions(
    {
      scope: AccessScope.PLATFORM,
      match: PermissionMatch.ALL,
    },
    ...permissionCodes,
  );
}

export function RequireAnyPlatformPermission(
  ...permissionCodes: string[]
): MethodDecorator & ClassDecorator {
  return RequirePermissions(
    {
      scope: AccessScope.PLATFORM,
      match: PermissionMatch.ANY,
    },
    ...permissionCodes,
  );
}

export function RequirePlatformSuperAdmin(): MethodDecorator & ClassDecorator {
  return applyDecorators(UseGuards(JwtAuthGuard, PlatformSuperAdminGuard));
}

export function RequireOrganizationPermissions(
  ...permissionCodes: string[]
): MethodDecorator & ClassDecorator {
  return RequirePermissions(
    {
      scope: AccessScope.ORGANIZATION,
      match: PermissionMatch.ALL,
    },
    ...permissionCodes,
  );
}

export function RequireAnyOrganizationPermission(
  ...permissionCodes: string[]
): MethodDecorator & ClassDecorator {
  return RequirePermissions(
    {
      scope: AccessScope.ORGANIZATION,
      match: PermissionMatch.ANY,
    },
    ...permissionCodes,
  );
}
