import { Module } from '@nestjs/common';
import { PlatformSuperAdminGuard } from '../../common/guards/platform-super-admin.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuthModule } from '../auth/auth.module';
import { AccessControlCacheService } from './access-control-cache.service';
import { AccessControlService } from './access-control.service';
import { CurrentUserAccessController } from './current-user-access.controller';
import { CurrentUserAccessService } from './current-user-access.service';
import { OrganizationMembersController } from './organization-members.controller';
import { OrganizationMembersService } from './organization-members.service';
import { RoleManagementController } from './role-management.controller';
import { RoleManagementService } from './role-management.service';

@Module({
  imports: [AuthModule],
  controllers: [
    CurrentUserAccessController,
    OrganizationMembersController,
    RoleManagementController,
  ],
  providers: [
    AccessControlCacheService,
    AccessControlService,
    CurrentUserAccessService,
    OrganizationMembersService,
    PlatformSuperAdminGuard,
    PermissionsGuard,
    RoleManagementService,
  ],
  exports: [
    AccessControlService,
    AccessControlCacheService,
    AuthModule,
    PlatformSuperAdminGuard,
    PermissionsGuard,
  ],
})
export class AccessControlModule {}
