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
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  RequireOrganizationPermissions,
  RequireAnyOrganizationPermission,
} from '../../common/decorators/require-permissions.decorator';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import { ORGANIZATION_PERMISSIONS } from '../access-control/rbac.constants';
import {
  CreateKnowledgeBaseCategoryDto,
  CreateKnowledgeBaseCollectionDto,
  CreateKnowledgeBaseDto,
  CreateKnowledgeBaseFolderDto,
  CreateKnowledgeBaseTagDto,
  ListKnowledgeBasesQueryDto,
  UpdateKnowledgeBaseDto,
} from './dto/knowledge-base.dto';
import { OrganizationKnowledgeBaseIdDto } from './dto/knowledge-base-id.dto';
import { KnowledgeBasesService } from './knowledge-bases.service';

const CSRF_HEADER = {
  name: 'x-csrf-token',
  required: true,
  description: 'Token returned by GET /auth/csrf',
} as const;

@ApiTags('Knowledge Bases')
@ApiBearerAuth('access-token')
@ApiCookieAuth('access-cookie')
@ApiUnauthorizedResponse({
  description: 'Access token is missing, invalid, or expired',
})
@ApiForbiddenResponse({
  description: 'The user does not have the required organization permission',
})
@Controller('organizations/:organizationId/knowledge-bases')
export class KnowledgeBasesController {
  constructor(private readonly knowledgeBasesService: KnowledgeBasesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsRead)
  @ApiOperation({ summary: 'List organization Knowledge Bases' })
  async listKnowledgeBases(
    @Param('organizationId') organizationId: string,
    @Query() query: ListKnowledgeBasesQueryDto,
  ) {
    return {
      data: await this.knowledgeBasesService.listKnowledgeBases(
        organizationId,
        query,
      ),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  @RequireAnyOrganizationPermission(
    ORGANIZATION_PERMISSIONS.documentsUpload,
    ORGANIZATION_PERMISSIONS.documentsUpdate,
  )
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({ summary: 'Create an organization Knowledge Base' })
  async createKnowledgeBase(
    @Param('organizationId') organizationId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: CreateKnowledgeBaseDto,
  ) {
    return {
      data: {
        knowledgeBase: await this.knowledgeBasesService.createKnowledgeBase(
          organizationId,
          principal,
          dto,
        ),
      },
    };
  }

  @Get('categories')
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsRead)
  @ApiOperation({ summary: 'List organization Knowledge Base categories' })
  async listCategories(@Param('organizationId') organizationId: string) {
    return {
      data: await this.knowledgeBasesService.listCategories(organizationId),
    };
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  @RequireAnyOrganizationPermission(
    ORGANIZATION_PERMISSIONS.documentsUpload,
    ORGANIZATION_PERMISSIONS.documentsUpdate,
  )
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({ summary: 'Create an organization Knowledge Base category' })
  async createCategory(
    @Param('organizationId') organizationId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: CreateKnowledgeBaseCategoryDto,
  ) {
    return {
      data: await this.knowledgeBasesService.createCategory(
        organizationId,
        principal,
        dto,
      ),
    };
  }

  @Get('tags')
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsRead)
  @ApiOperation({ summary: 'List organization Knowledge Base tags' })
  async listTags(@Param('organizationId') organizationId: string) {
    return {
      data: await this.knowledgeBasesService.listTags(organizationId),
    };
  }

  @Post('tags')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  @RequireAnyOrganizationPermission(
    ORGANIZATION_PERMISSIONS.documentsUpload,
    ORGANIZATION_PERMISSIONS.documentsUpdate,
  )
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({ summary: 'Create an organization Knowledge Base tag' })
  async createTag(
    @Param('organizationId') organizationId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: CreateKnowledgeBaseTagDto,
  ) {
    return {
      data: await this.knowledgeBasesService.createTag(
        organizationId,
        principal,
        dto,
      ),
    };
  }

  @Get(':knowledgeBaseId')
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsRead)
  @ApiOkResponse({ description: 'Knowledge Base detail' })
  async getKnowledgeBase(@Param() params: OrganizationKnowledgeBaseIdDto) {
    return {
      data: {
        knowledgeBase: await this.knowledgeBasesService.getKnowledgeBase(
          params.organizationId,
          params.knowledgeBaseId,
        ),
      },
    };
  }

  @Patch(':knowledgeBaseId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @RequireAnyOrganizationPermission(
    ORGANIZATION_PERMISSIONS.documentsUpload,
    ORGANIZATION_PERMISSIONS.documentsUpdate,
  )
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({ summary: 'Update an organization Knowledge Base' })
  async updateKnowledgeBase(
    @Param() params: OrganizationKnowledgeBaseIdDto,
    @Body() dto: UpdateKnowledgeBaseDto,
  ) {
    return {
      data: {
        knowledgeBase: await this.knowledgeBasesService.updateKnowledgeBase(
          params.organizationId,
          params.knowledgeBaseId,
          dto,
        ),
      },
    };
  }

  @Delete(':knowledgeBaseId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @RequireAnyOrganizationPermission(
    ORGANIZATION_PERMISSIONS.documentsUpload,
    ORGANIZATION_PERMISSIONS.documentsUpdate,
  )
  @ApiHeader(CSRF_HEADER)
  @ApiOperation({ summary: 'Archive an organization Knowledge Base' })
  async archiveKnowledgeBase(@Param() params: OrganizationKnowledgeBaseIdDto) {
    return {
      data: {
        knowledgeBase: await this.knowledgeBasesService.archiveKnowledgeBase(
          params.organizationId,
          params.knowledgeBaseId,
        ),
      },
    };
  }

  @Get(':knowledgeBaseId/collections')
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsRead)
  async listCollections(@Param() params: OrganizationKnowledgeBaseIdDto) {
    return {
      data: await this.knowledgeBasesService.listCollections(
        params.organizationId,
        params.knowledgeBaseId,
      ),
    };
  }

  @Post(':knowledgeBaseId/collections')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  @RequireAnyOrganizationPermission(
    ORGANIZATION_PERMISSIONS.documentsUpload,
    ORGANIZATION_PERMISSIONS.documentsUpdate,
  )
  @ApiHeader(CSRF_HEADER)
  async createCollection(
    @Param() params: OrganizationKnowledgeBaseIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: CreateKnowledgeBaseCollectionDto,
  ) {
    return {
      data: await this.knowledgeBasesService.createCollection(
        params.organizationId,
        params.knowledgeBaseId,
        principal,
        dto,
      ),
    };
  }

  @Get(':knowledgeBaseId/folders')
  @HttpCode(HttpStatus.OK)
  @RequireOrganizationPermissions(ORGANIZATION_PERMISSIONS.documentsRead)
  async listFolders(@Param() params: OrganizationKnowledgeBaseIdDto) {
    return {
      data: await this.knowledgeBasesService.listFolders(
        params.organizationId,
        params.knowledgeBaseId,
      ),
    };
  }

  @Post(':knowledgeBaseId/folders')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(CsrfGuard)
  @RequireAnyOrganizationPermission(
    ORGANIZATION_PERMISSIONS.documentsUpload,
    ORGANIZATION_PERMISSIONS.documentsUpdate,
  )
  @ApiHeader(CSRF_HEADER)
  async createFolder(
    @Param() params: OrganizationKnowledgeBaseIdDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Body() dto: CreateKnowledgeBaseFolderDto,
  ) {
    return {
      data: await this.knowledgeBasesService.createFolder(
        params.organizationId,
        params.knowledgeBaseId,
        principal,
        dto,
      ),
    };
  }
}
