import { Module } from '@nestjs/common';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuthModule } from '../auth/auth.module';
import { AccessControlCacheService } from './access-control-cache.service';
import { AccessControlService } from './access-control.service';
import { OrganizationMembersController } from './organization-members.controller';
import { OrganizationMembersService } from './organization-members.service';
import { RoleManagementController } from './role-management.controller';
import { RoleManagementService } from './role-management.service';

@Module({
  imports: [AuthModule],
  controllers: [OrganizationMembersController, RoleManagementController],
  providers: [
    AccessControlCacheService,
    AccessControlService,
    OrganizationMembersService,
    PermissionsGuard,
    RoleManagementService,
  ],
  exports: [AccessControlService, AuthModule, PermissionsGuard],
})
export class AccessControlModule {}
