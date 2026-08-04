import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { InviteAcceptanceController } from './invite-acceptance.controller';
import { JoinRequestsController } from './join-requests.controller';
import { JoinRequestsService } from './join-requests.service';
import { OrganizationBillingController } from './organization-billing.controller';
import { OrganizationBillingService } from './organization-billing.service';
import { OrganizationInvitesController } from './organization-invites.controller';
import { OrganizationInvitesService } from './organization-invites.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [AccessControlModule],
  controllers: [
    InviteAcceptanceController,
    JoinRequestsController,
    OrganizationBillingController,
    OrganizationInvitesController,
    OrganizationsController,
  ],
  providers: [
    JoinRequestsService,
    OrganizationBillingService,
    OrganizationInvitesService,
    OrganizationsService,
  ],
})
export class OrganizationsModule {}
