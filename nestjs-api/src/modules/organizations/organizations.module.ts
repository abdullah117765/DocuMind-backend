import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { RagOrchestratorService } from '../documents/rag-orchestrator.service';
import { InviteAcceptanceController } from './invite-acceptance.controller';
import { JoinRequestsController } from './join-requests.controller';
import { JoinRequestsService } from './join-requests.service';
import { OrganizationInvitesController } from './organization-invites.controller';
import { OrganizationInvitesService } from './organization-invites.service';
import {
  OrganizationSettingsController,
  OrganizationsController,
} from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [AccessControlModule],
  controllers: [
    InviteAcceptanceController,
    JoinRequestsController,
    OrganizationInvitesController,
    OrganizationSettingsController,
    OrganizationsController,
  ],
  providers: [
    JoinRequestsService,
    OrganizationInvitesService,
    OrganizationsService,
    RagOrchestratorService,
  ],
})
export class OrganizationsModule {}
