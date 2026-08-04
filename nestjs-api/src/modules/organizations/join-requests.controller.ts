import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
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
import { RequireOrganizationPermissions } from '../../common/decorators/require-permissions.decorator';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrganizationIdDto } from '../access-control/dto/organization-id.dto';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import { AcceptJoinRequestDto } from './dto/accept-join-request.dto';
import { CreateJoinRequestDto } from './dto/create-join-request.dto';
import { JoinRequestParamsDto } from './dto/join-request-params.dto';
import { ListJoinRequestsQueryDto } from './dto/list-join-requests-query.dto';
import { MyJoinRequestParamsDto } from './dto/my-join-request-params.dto';
import { RejectJoinRequestDto } from './dto/reject-join-request.dto';
import {
  DiscoverOrganizationView,
  JoinRequestView,
  JoinRequestsService,
} from './join-requests.service';

interface DiscoverOrganizationsResult {
  data: {
    organizations: DiscoverOrganizationView[];
  };
}

interface JoinRequestsResult {
  data: {
    joinRequests: JoinRequestView[];
  };
}

interface JoinRequestResult {
  data: {
    joinRequest: JoinRequestView;
  };
}

const CSRF_HEADER = {
  name: 'x-csrf-token',
  required: true,
  description: 'Token returned by GET /auth/csrf',
} as const;

@ApiTags('Join Requests')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access-cookie')
@Controller()
export class JoinRequestsController {
  constructor(private readonly joinRequestsService: JoinRequestsService) {}

  @Get('access/organizations/discover')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Discover organizations accepting join requests' })
  @ApiOkResponse({ description: 'Discoverable organizations' })
  async discoverOrganizations(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<DiscoverOrganizationsResult> {
    return {
      data: {
        organizations: await this.joinRequestsService.discoverOrganizations(
          principal.userId,
        ),
      },
    };
  }

  @Get('access/my-join-requests')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'List my organization join requests' })
  async listMyRequests(
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<JoinRequestsResult> {
    return {
      data: {
        joinRequests: await this.joinRequestsService.listMyRequests(
          principal.userId,
        ),
      },
    };
  }

  @Post('access/organizations/:organizationId/join-requests')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiHeader(CSRF_HEADER)
  @ApiBody({ type: CreateJoinRequestDto })
  @ApiOperation({ summary: 'Request access to an organization' })
  async createJoinRequest(
    @Param() params: OrganizationIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: CreateJoinRequestDto,
  ): Promise<JoinRequestResult> {
    return {
      data: {
        joinRequest: await this.joinRequestsService.createJoinRequest(
          params.organizationId,
          principal,
          dto,
        ),
      },
    };
  }

  @Delete('access/my-join-requests/:requestId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, CsrfGuard)
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({ summary: 'Cancel my pending join request' })
  async cancelMyRequest(
    @Param() params: MyJoinRequestParamsDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ): Promise<{ message: string }> {
    await this.joinRequestsService.cancelMyRequest(
      principal.userId,
      params.requestId,
    );

    return { message: 'Join request canceled successfully' };
  }

  @Get('organizations/:organizationId/join-requests')
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationPermissions('users.manage')
  @ApiOperation({ summary: 'List organization join requests' })
  async listOrganizationRequests(
    @Param() params: OrganizationIdDto,
    @Query() query: ListJoinRequestsQueryDto,
  ): Promise<JoinRequestsResult> {
    return {
      data: {
        joinRequests:
          await this.joinRequestsService.listOrganizationRequests(
            params.organizationId,
            query.status,
          ),
      },
    };
  }

  @Patch('organizations/:organizationId/join-requests/:requestId/accept')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @RequireOrganizationPermissions('users.manage')
  @ApiHeader(CSRF_HEADER)
  @ApiBody({ type: AcceptJoinRequestDto })
  @ApiOperation({ summary: 'Accept a pending join request' })
  async acceptRequest(
    @Param() params: JoinRequestParamsDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: AcceptJoinRequestDto,
  ): Promise<JoinRequestResult> {
    return {
      data: {
        joinRequest: await this.joinRequestsService.acceptRequest(
          params.organizationId,
          params.requestId,
          principal.userId,
          dto,
        ),
      },
    };
  }

  @Patch('organizations/:organizationId/join-requests/:requestId/reject')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @RequireOrganizationPermissions('users.manage')
  @ApiHeader(CSRF_HEADER)
  @ApiBody({ type: RejectJoinRequestDto })
  @ApiOperation({ summary: 'Reject a pending join request' })
  async rejectRequest(
    @Param() params: JoinRequestParamsDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: RejectJoinRequestDto,
  ): Promise<JoinRequestResult> {
    return {
      data: {
        joinRequest: await this.joinRequestsService.rejectRequest(
          params.organizationId,
          params.requestId,
          principal.userId,
          dto,
        ),
      },
    };
  }
}
