import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AccessScope } from '../../generated/prisma/client';
import { AccessControlService } from '../../modules/access-control/access-control.service';
import type {
  OrganizationAccess,
  PlatformAccess,
} from '../../modules/access-control/access-control.types';
import {
  PERMISSION_REQUIREMENT_METADATA,
  PermissionMatch,
  PermissionRequirement,
} from '../../modules/access-control/permission-requirement';
import type { AuthenticatedPrincipal } from '../../modules/auth/interfaces/authenticated-principal.interface';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AuthorizedAccess = PlatformAccess | OrganizationAccess;

export type AuthorizedRequest = Request & {
  user?: AuthenticatedPrincipal;
  authorizedAccess?: AuthorizedAccess;
};

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessControlService: AccessControlService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      PERMISSION_REQUIREMENT_METADATA,
      [context.getHandler(), context.getClass()],
    );

    if (!requirement) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    const userId = request.user?.userId;

    if (!userId) {
      throw new UnauthorizedException();
    }

    const access = await this.resolveAccess(requirement, request, userId);

    if (!access || !this.hasRequiredPermissions(requirement, access)) {
      throw new ForbiddenException();
    }

    request.authorizedAccess = access;

    return true;
  }

  private async resolveAccess(
    requirement: PermissionRequirement,
    request: AuthorizedRequest,
    userId: string,
  ): Promise<AuthorizedAccess | null> {
    if (requirement.scope === AccessScope.PLATFORM) {
      return this.accessControlService.resolvePlatformAccess(userId);
    }

    const parameterName = requirement.organizationIdParam ?? 'organizationId';
    const organizationId = request.params?.[parameterName];

    if (
      typeof organizationId !== 'string' ||
      !UUID_V4_PATTERN.test(organizationId)
    ) {
      throw new BadRequestException(
        `Route parameter "${parameterName}" must be a UUID v4`,
      );
    }

    return this.accessControlService.resolveOrganizationAccess(
      userId,
      organizationId,
    );
  }

  private hasRequiredPermissions(
    requirement: PermissionRequirement,
    access: AuthorizedAccess,
  ): boolean {
    const grantedPermissions = new Set(access.permissions);
    const matches = (permissionCode: string): boolean =>
      grantedPermissions.has(permissionCode);

    return requirement.match === PermissionMatch.ANY
      ? requirement.permissionCodes.some(matches)
      : requirement.permissionCodes.every(matches);
  }
}
