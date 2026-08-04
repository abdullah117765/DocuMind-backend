import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AccessScope } from '../../generated/prisma/client';
import { PLATFORM_ROLE_KEYS } from '../../modules/access-control/rbac.constants';
import type { AuthenticatedPrincipal } from '../../modules/auth/interfaces/authenticated-principal.interface';
import { PrismaService } from '../../modules/prisma/prisma.service';

type PlatformSuperAdminRequest = Request & {
  user?: AuthenticatedPrincipal;
};

@Injectable()
export class PlatformSuperAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<PlatformSuperAdminRequest>();
    const userId = request.user?.userId;

    if (!userId) {
      throw new UnauthorizedException();
    }

    const assignment = await this.prisma.platformUserRole.findFirst({
      where: {
        userId,
        role: {
          is: {
            systemKey: PLATFORM_ROLE_KEYS.superAdmin,
            scope: AccessScope.PLATFORM,
            isActive: true,
          },
        },
      },
      select: { roleId: true },
    });

    if (!assignment) {
      throw new ForbiddenException('Super Admin access is required.');
    }

    return true;
  }
}
