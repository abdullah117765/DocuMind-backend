import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import {
  RequireAnyOrganizationPermission,
  RequirePlatformSuperAdmin,
} from '../../common/decorators/require-permissions.decorator';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { OrganizationIdDto } from '../access-control/dto/organization-id.dto';
import { UpdateOrganizationLimitsDto } from './dto/update-organization-limits.dto';
import { UpdateOrganizationSubscriptionDto } from './dto/update-organization-subscription.dto';
import {
  OrganizationBillingService,
  OrganizationLimitsView,
  OrganizationSubscriptionView,
} from './organization-billing.service';

interface SubscriptionResult {
  data: {
    subscription: OrganizationSubscriptionView;
  };
}

interface LimitsResult {
  data: {
    limits: OrganizationLimitsView;
  };
}

const CSRF_HEADER = {
  name: 'x-csrf-token',
  required: true,
  description: 'Token returned by GET /auth/csrf',
} as const;

@ApiTags('Organization Billing')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access-cookie')
@Controller()
export class OrganizationBillingController {
  constructor(private readonly billingService: OrganizationBillingService) {}

  @Get('organizations/:organizationId/subscription')
  @HttpCode(HttpStatus.OK)
  @RequireAnyOrganizationPermission('billing.manage')
  @ApiOperation({ summary: 'Get organization subscription' })
  @ApiOkResponse({ description: 'Organization subscription' })
  async getSubscription(
    @Param() params: OrganizationIdDto,
  ): Promise<SubscriptionResult> {
    return {
      data: {
        subscription: await this.billingService.getSubscription(
          params.organizationId,
        ),
      },
    };
  }

  @Get('organizations/:organizationId/limits')
  @HttpCode(HttpStatus.OK)
  @RequireAnyOrganizationPermission('billing.manage')
  @ApiOperation({ summary: 'Get organization limits' })
  @ApiOkResponse({ description: 'Organization limits' })
  async getLimits(@Param() params: OrganizationIdDto): Promise<LimitsResult> {
    return {
      data: {
        limits: await this.billingService.getLimits(params.organizationId),
      },
    };
  }

  @Patch('platform/organizations/:organizationId/subscription')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @RequirePlatformSuperAdmin()
  @ApiHeader(CSRF_HEADER)
  @ApiBody({ type: UpdateOrganizationSubscriptionDto })
  @ApiOperation({ summary: 'Update organization subscription as Super Admin' })
  async updateSubscription(
    @Param() params: OrganizationIdDto,
    @Body() dto: UpdateOrganizationSubscriptionDto,
  ): Promise<SubscriptionResult> {
    return {
      data: {
        subscription: await this.billingService.updateSubscription(
          params.organizationId,
          dto,
        ),
      },
    };
  }

  @Patch('platform/organizations/:organizationId/limits')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @RequirePlatformSuperAdmin()
  @ApiHeader(CSRF_HEADER)
  @ApiBody({ type: UpdateOrganizationLimitsDto })
  @ApiOperation({ summary: 'Update organization limits as Super Admin' })
  async updateLimits(
    @Param() params: OrganizationIdDto,
    @Body() dto: UpdateOrganizationLimitsDto,
  ): Promise<LimitsResult> {
    return {
      data: {
        limits: await this.billingService.updateLimits(
          params.organizationId,
          dto,
        ),
      },
    };
  }
}
