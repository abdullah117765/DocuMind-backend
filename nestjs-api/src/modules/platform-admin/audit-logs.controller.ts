import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import { AuditLogListResult, AuditLogsService } from './audit-logs.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

interface AuditLogsResult {
  data: AuditLogListResult;
}

@ApiTags('Audit Logs')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access-cookie')
@UseGuards(JwtAuthGuard)
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List platform audit logs' })
  @ApiOkResponse({ description: 'Audit logs' })
  async listAuditLogs(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<AuditLogsResult> {
    return {
      data: await this.auditLogsService.listAuditLogs(query, principal),
    };
  }
}
