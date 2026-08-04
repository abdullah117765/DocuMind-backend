import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuditLogsController } from './audit-logs.controller';
import { AuditLogsService } from './audit-logs.service';
import { UserManagementController } from './user-management.controller';
import { UserManagementService } from './user-management.service';

@Module({
  imports: [AccessControlModule],
  controllers: [AuditLogsController, UserManagementController],
  providers: [AuditLogsService, UserManagementService],
})
export class PlatformAdminModule {}
