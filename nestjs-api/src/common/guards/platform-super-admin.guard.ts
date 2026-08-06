import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { EnvSuperAdminService } from '../../modules/auth/env-super-admin.service';
import type { AuthenticatedPrincipal } from '../../modules/auth/interfaces/authenticated-principal.interface';

type PlatformSuperAdminRequest = Request & {
  user?: AuthenticatedPrincipal;
};

@Injectable()
export class PlatformSuperAdminGuard implements CanActivate {
  constructor(private readonly envSuperAdminService: EnvSuperAdminService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<PlatformSuperAdminRequest>();
    const userId = request.user?.userId;

    if (!userId) {
      throw new UnauthorizedException();
    }

    if (
      !request.user?.isEnvSuperAdmin &&
      !(await this.envSuperAdminService.isConfiguredUserId(userId))
    ) {
      throw new ForbiddenException('Super Admin access is required.');
    }

    return true;
  }
}
