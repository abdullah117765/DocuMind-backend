import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
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

  @Get('export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Download audit logs as a text file' })
  @ApiOkResponse({ description: 'Audit log text export' })
  async exportAuditLogs(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query() query: ListAuditLogsQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const exportResult = await this.auditLogsService.exportAuditLogs(
      query,
      principal,
    );

    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${exportResult.filename}"`,
    );
    response.setHeader('X-Audit-Log-Export-Count', String(exportResult.count));
    response.setHeader(
      'X-Audit-Log-Export-Truncated',
      exportResult.truncated ? 'true' : 'false',
    );

    return new StreamableFile(Buffer.from(exportResult.content, 'utf8'));
  }
}
