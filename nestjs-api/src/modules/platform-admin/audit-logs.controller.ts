import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePlatformSuperAdmin } from '../../common/decorators/require-permissions.decorator';
import {
  AuditLogListResult,
  AuditLogsService,
} from './audit-logs.service';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto';

interface AuditLogsResult {
  data: AuditLogListResult;
}

@ApiTags('Audit Logs')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access-cookie')
@RequirePlatformSuperAdmin()
@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly auditLogsService: AuditLogsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List platform audit logs' })
  @ApiOkResponse({ description: 'Audit logs' })
  async listAuditLogs(
    @Query() query: ListAuditLogsQueryDto,
  ): Promise<AuditLogsResult> {
    return {
      data: await this.auditLogsService.listAuditLogs(query),
    };
  }
}
