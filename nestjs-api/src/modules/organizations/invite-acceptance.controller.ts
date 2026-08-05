import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCookieAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import { AcceptInviteWithTemporaryPasswordDto } from './dto/accept-invite-with-temporary-password.dto';
import { InviteTokenDto } from './dto/invite-token.dto';
import {
  OrganizationInviteAcceptResult,
  OrganizationInvitePreview,
  OrganizationInvitesService,
} from './organization-invites.service';

@ApiTags('Organization Invites')
@Controller('organization-invites')
export class InviteAcceptanceController {
  constructor(private readonly invitesService: OrganizationInvitesService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: InviteTokenDto })
  @ApiOperation({ summary: 'Preview an organization invitation token' })
  @ApiOkResponse({ description: 'Invitation preview' })
  previewInvite(
    @Body() dto: InviteTokenDto,
  ): Promise<{ data: OrganizationInvitePreview }> {
    return this.invitesService.previewInvite(dto.token);
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiBearerAuth('access-token')
  @ApiCookieAuth('access-cookie')
  @ApiHeader({
    name: 'x-csrf-token',
    required: true,
    description: 'Token returned by GET /auth/csrf',
  })
  @ApiBody({ type: InviteTokenDto })
  @ApiOperation({ summary: 'Accept an organization invitation token' })
  acceptInvite(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: InviteTokenDto,
  ): Promise<OrganizationInviteAcceptResult> {
    return this.invitesService.acceptInvite(dto.token, principal);
  }

  @Post('accept-with-temporary-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @ApiHeader({
    name: 'x-csrf-token',
    required: true,
    description: 'Token returned by GET /auth/csrf',
  })
  @ApiBody({ type: AcceptInviteWithTemporaryPasswordDto })
  @ApiOperation({
    summary:
      'Accept an invitation for a new user with a one-time password and set a permanent password',
  })
  @ApiOkResponse({
    description: 'Invitation accepted and account activated',
  })
  acceptInviteWithTemporaryPassword(
    @Body() dto: AcceptInviteWithTemporaryPasswordDto,
  ): Promise<OrganizationInviteAcceptResult> {
    return this.invitesService.acceptInviteWithTemporaryPassword(dto);
  }
}
