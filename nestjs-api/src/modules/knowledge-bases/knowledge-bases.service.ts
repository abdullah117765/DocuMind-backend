import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  KnowledgeBaseStatus,
  Prisma,
} from '../../generated/prisma/client';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-principal.interface';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateKnowledgeBaseCategoryDto,
  CreateKnowledgeBaseCollectionDto,
  CreateKnowledgeBaseDto,
  CreateKnowledgeBaseFolderDto,
  CreateKnowledgeBaseTagDto,
  DocumentKnowledgeBaseAssignmentDto,
  ListKnowledgeBasesQueryDto,
  UpdateKnowledgeBaseDto,
} from './dto/knowledge-base.dto';

const DEFAULT_KNOWLEDGE_BASE_NAME = 'Default Knowledge Base';
const DEFAULT_KNOWLEDGE_BASE_SLUG = 'default-knowledge-base';

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function slugify(value: string): string {
  const slug = normalizeName(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);

  return slug || 'item';
}

function uniqueValues(values: string[] | undefined): string[] {
  return [...new Set(values ?? [])];
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

const knowledgeBaseSelect = {
  id: true,
  organizationId: true,
  name: true,
  slug: true,
  description: true,
  status: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      documents: true,
      collections: true,
      folders: true,
    },
  },
} as const satisfies Prisma.KnowledgeBaseSelect;

const knowledgeBaseDetailSelect = {
  ...knowledgeBaseSelect,
  folders: {
    orderBy: [{ name: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      organizationId: true,
      knowledgeBaseId: true,
      parentId: true,
      name: true,
      slug: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  collections: {
    orderBy: [{ name: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      organizationId: true,
      knowledgeBaseId: true,
      name: true,
      slug: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          documents: true,
        },
      },
    },
  },
} as const satisfies Prisma.KnowledgeBaseSelect;

type KnowledgeBaseRecord = Prisma.KnowledgeBaseGetPayload<{
  select: typeof knowledgeBaseSelect;
}>;

type KnowledgeBaseDetailRecord = Prisma.KnowledgeBaseGetPayload<{
  select: typeof knowledgeBaseDetailSelect;
}>;

export interface KnowledgeBaseView {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  status: KnowledgeBaseStatus;
  isDefault: boolean;
  counts: {
    documents: number;
    collections: number;
    folders: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface KnowledgeBaseListResult {
  knowledgeBases: KnowledgeBaseView[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}

@Injectable()
export class KnowledgeBasesService {
  constructor(private readonly prisma: PrismaService) {}

  async listKnowledgeBases(
    organizationId: string,
    query: ListKnowledgeBasesQueryDto,
  ): Promise<KnowledgeBaseListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.KnowledgeBaseWhereInput = {
      organizationId,
      status: KnowledgeBaseStatus.ACTIVE,
      ...(query.search
        ? {
            OR: [
              {
                name: {
                  contains: query.search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                slug: {
                  contains: query.search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            ],
          }
        : {}),
    };

    const [total, records] = await Promise.all([
      this.prisma.knowledgeBase.count({ where }),
      this.prisma.knowledgeBase.findMany({
        where,
        select: knowledgeBaseSelect,
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      knowledgeBases: records.map((record) => this.toKnowledgeBaseView(record)),
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(Math.ceil(total / pageSize), 1),
      },
    };
  }

  async getKnowledgeBase(
    organizationId: string,
    knowledgeBaseId: string,
  ): Promise<KnowledgeBaseView & {
    folders: Array<Record<string, unknown>>;
    collections: Array<Record<string, unknown>>;
  }> {
    const record = await this.prisma.knowledgeBase.findFirst({
      where: {
        id: knowledgeBaseId,
        organizationId,
        status: KnowledgeBaseStatus.ACTIVE,
      },
      select: knowledgeBaseDetailSelect,
    });

    if (!record) {
      throw new NotFoundException('Knowledge Base not found.');
    }

    return this.toKnowledgeBaseDetailView(record);
  }

  async createKnowledgeBase(
    organizationId: string,
    principal: AuthenticatedPrincipal,
    dto: CreateKnowledgeBaseDto,
  ): Promise<KnowledgeBaseView> {
    try {
      const record = await this.prisma.knowledgeBase.create({
        data: {
          organizationId,
          name: dto.name,
          normalizedName: normalizeName(dto.name),
          slug: slugify(dto.name),
          description: dto.description || null,
          createdByUserId: principal.userId,
        },
        select: knowledgeBaseSelect,
      });

      return this.toKnowledgeBaseView(record);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          'A Knowledge Base with this name already exists.',
        );
      }

      throw error;
    }
  }

  async updateKnowledgeBase(
    organizationId: string,
    knowledgeBaseId: string,
    dto: UpdateKnowledgeBaseDto,
  ): Promise<KnowledgeBaseView> {
    await this.assertKnowledgeBaseExists(organizationId, knowledgeBaseId);

    try {
      const record = await this.prisma.knowledgeBase.update({
        where: { id: knowledgeBaseId },
        data: {
          ...(dto.name
            ? {
                name: dto.name,
                normalizedName: normalizeName(dto.name),
                slug: slugify(dto.name),
              }
            : {}),
          ...(dto.description !== undefined
            ? { description: dto.description || null }
            : {}),
        },
        select: knowledgeBaseSelect,
      });

      return this.toKnowledgeBaseView(record);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          'A Knowledge Base with this name already exists.',
        );
      }

      throw error;
    }
  }

  async archiveKnowledgeBase(
    organizationId: string,
    knowledgeBaseId: string,
  ): Promise<KnowledgeBaseView> {
    const existing = await this.assertKnowledgeBaseExists(
      organizationId,
      knowledgeBaseId,
    );

    if (existing.isDefault) {
      throw new BadRequestException(
        'The default Knowledge Base cannot be archived.',
      );
    }

    const record = await this.prisma.knowledgeBase.update({
      where: { id: knowledgeBaseId },
      data: { status: KnowledgeBaseStatus.ARCHIVED },
      select: knowledgeBaseSelect,
    });

    return this.toKnowledgeBaseView(record);
  }

  async ensureDefaultKnowledgeBase(
    organizationId: string,
    createdByUserId?: string | null,
  ): Promise<{ id: string; organizationId: string; name: string; slug: string }> {
    const existing = await this.prisma.knowledgeBase.findFirst({
      where: {
        organizationId,
        isDefault: true,
      },
      select: {
        id: true,
        organizationId: true,
        name: true,
        slug: true,
      },
    });

    if (existing) return existing;

    return this.prisma.knowledgeBase.create({
      data: {
        organizationId,
        name: DEFAULT_KNOWLEDGE_BASE_NAME,
        normalizedName: normalizeName(DEFAULT_KNOWLEDGE_BASE_NAME),
        slug: DEFAULT_KNOWLEDGE_BASE_SLUG,
        description: 'Default workspace for organization documents.',
        isDefault: true,
        createdByUserId: createdByUserId ?? null,
      },
      select: {
        id: true,
        organizationId: true,
        name: true,
        slug: true,
      },
    });
  }

  async listCollections(organizationId: string, knowledgeBaseId: string) {
    await this.assertKnowledgeBaseExists(organizationId, knowledgeBaseId);

    return {
      collections: await this.prisma.knowledgeBaseCollection.findMany({
        where: { organizationId, knowledgeBaseId },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          organizationId: true,
          knowledgeBaseId: true,
          name: true,
          slug: true,
          description: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { documents: true } },
        },
      }),
    };
  }

  async createCollection(
    organizationId: string,
    knowledgeBaseId: string,
    principal: AuthenticatedPrincipal,
    dto: CreateKnowledgeBaseCollectionDto,
  ) {
    await this.assertKnowledgeBaseExists(organizationId, knowledgeBaseId);

    try {
      const collection = await this.prisma.knowledgeBaseCollection.create({
        data: {
          organizationId,
          knowledgeBaseId,
          name: dto.name,
          normalizedName: normalizeName(dto.name),
          slug: slugify(dto.name),
          description: dto.description || null,
          createdByUserId: principal.userId,
        },
        select: {
          id: true,
          organizationId: true,
          knowledgeBaseId: true,
          name: true,
          slug: true,
          description: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return { collection };
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          'A Collection with this name already exists in this Knowledge Base.',
        );
      }

      throw error;
    }
  }

  async listFolders(organizationId: string, knowledgeBaseId: string) {
    await this.assertKnowledgeBaseExists(organizationId, knowledgeBaseId);

    return {
      folders: await this.prisma.knowledgeBaseFolder.findMany({
        where: { organizationId, knowledgeBaseId },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          organizationId: true,
          knowledgeBaseId: true,
          parentId: true,
          name: true,
          slug: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    };
  }

  async createFolder(
    organizationId: string,
    knowledgeBaseId: string,
    principal: AuthenticatedPrincipal,
    dto: CreateKnowledgeBaseFolderDto,
  ) {
    await this.assertKnowledgeBaseExists(organizationId, knowledgeBaseId);

    if (dto.parentId) {
      const parent = await this.prisma.knowledgeBaseFolder.findFirst({
        where: { id: dto.parentId, organizationId, knowledgeBaseId },
        select: { id: true },
      });

      if (!parent) {
        throw new NotFoundException('Parent folder not found.');
      }
    }

    try {
      const folder = await this.prisma.knowledgeBaseFolder.create({
        data: {
          organizationId,
          knowledgeBaseId,
          parentId: dto.parentId ?? null,
          name: dto.name,
          normalizedName: normalizeName(dto.name),
          slug: slugify(dto.name),
          createdByUserId: principal.userId,
        },
        select: {
          id: true,
          organizationId: true,
          knowledgeBaseId: true,
          parentId: true,
          name: true,
          slug: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return { folder };
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          'A Folder with this name already exists at this level.',
        );
      }

      throw error;
    }
  }

  async listCategories(organizationId: string) {
    return {
      categories: await this.prisma.knowledgeBaseCategory.findMany({
        where: { organizationId },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          organizationId: true,
          name: true,
          slug: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    };
  }

  async createCategory(
    organizationId: string,
    principal: AuthenticatedPrincipal,
    dto: CreateKnowledgeBaseCategoryDto,
  ) {
    try {
      const category = await this.prisma.knowledgeBaseCategory.create({
        data: {
          organizationId,
          name: dto.name,
          normalizedName: normalizeName(dto.name),
          slug: slugify(dto.name),
          createdByUserId: principal.userId,
        },
        select: {
          id: true,
          organizationId: true,
          name: true,
          slug: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return { category };
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('A Category with this name already exists.');
      }

      throw error;
    }
  }

  async listTags(organizationId: string) {
    return {
      tags: await this.prisma.knowledgeBaseTag.findMany({
        where: { organizationId },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          organizationId: true,
          name: true,
          slug: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    };
  }

  async createTag(
    organizationId: string,
    principal: AuthenticatedPrincipal,
    dto: CreateKnowledgeBaseTagDto,
  ) {
    try {
      const tag = await this.prisma.knowledgeBaseTag.create({
        data: {
          organizationId,
          name: dto.name,
          normalizedName: normalizeName(dto.name),
          slug: slugify(dto.name),
          createdByUserId: principal.userId,
        },
        select: {
          id: true,
          organizationId: true,
          name: true,
          slug: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      return { tag };
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('A Tag with this name already exists.');
      }

      throw error;
    }
  }

  async validateDocumentAssignment(
    organizationId: string,
    assignment?: Partial<DocumentKnowledgeBaseAssignmentDto>,
  ): Promise<{
    knowledgeBaseIds: string[];
    folderId: string | null;
    collectionIds: string[];
    categoryId: string | null;
    tagIds: string[];
  }> {
    const knowledgeBaseIds = uniqueValues(assignment?.knowledgeBaseIds);

    if (knowledgeBaseIds.length === 0) {
      const defaultKnowledgeBase =
        await this.ensureDefaultKnowledgeBase(organizationId);

      return {
        knowledgeBaseIds: [defaultKnowledgeBase.id],
        folderId: null,
        collectionIds: [],
        categoryId: null,
        tagIds: [],
      };
    }

    const knowledgeBases = await this.prisma.knowledgeBase.findMany({
      where: {
        id: { in: knowledgeBaseIds },
        organizationId,
        status: KnowledgeBaseStatus.ACTIVE,
      },
      select: { id: true },
    });

    if (knowledgeBases.length !== knowledgeBaseIds.length) {
      throw new NotFoundException('Knowledge Base not found.');
    }

    const folderId = assignment?.folderId ?? null;
    if (folderId) {
      const folder = await this.prisma.knowledgeBaseFolder.findFirst({
        where: {
          id: folderId,
          organizationId,
          knowledgeBaseId: { in: knowledgeBaseIds },
        },
        select: { id: true },
      });

      if (!folder) {
        throw new NotFoundException('Folder not found.');
      }
    }

    const collectionIds = uniqueValues(assignment?.collectionIds);
    if (collectionIds.length > 0) {
      const collections = await this.prisma.knowledgeBaseCollection.findMany({
        where: {
          id: { in: collectionIds },
          organizationId,
          knowledgeBaseId: { in: knowledgeBaseIds },
        },
        select: { id: true },
      });

      if (collections.length !== collectionIds.length) {
        throw new NotFoundException('Collection not found.');
      }
    }

    const categoryId = assignment?.categoryId ?? null;
    if (categoryId) {
      const category = await this.prisma.knowledgeBaseCategory.findFirst({
        where: { id: categoryId, organizationId },
        select: { id: true },
      });

      if (!category) {
        throw new NotFoundException('Category not found.');
      }
    }

    const tagIds = uniqueValues(assignment?.tagIds);
    if (tagIds.length > 0) {
      const tags = await this.prisma.knowledgeBaseTag.findMany({
        where: { id: { in: tagIds }, organizationId },
        select: { id: true },
      });

      if (tags.length !== tagIds.length) {
        throw new NotFoundException('Tag not found.');
      }
    }

    return {
      knowledgeBaseIds,
      folderId,
      collectionIds,
      categoryId,
      tagIds,
    };
  }

  private async assertKnowledgeBaseExists(
    organizationId: string,
    knowledgeBaseId: string,
  ): Promise<{ id: string; isDefault: boolean }> {
    const record = await this.prisma.knowledgeBase.findFirst({
      where: {
        id: knowledgeBaseId,
        organizationId,
        status: KnowledgeBaseStatus.ACTIVE,
      },
      select: { id: true, isDefault: true },
    });

    if (!record) {
      throw new NotFoundException('Knowledge Base not found.');
    }

    return record;
  }

  private toKnowledgeBaseView(record: KnowledgeBaseRecord): KnowledgeBaseView {
    return {
      id: record.id,
      organizationId: record.organizationId,
      name: record.name,
      slug: record.slug,
      description: record.description,
      status: record.status,
      isDefault: record.isDefault,
      counts: {
        documents: record._count.documents,
        collections: record._count.collections,
        folders: record._count.folders,
      },
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private toKnowledgeBaseDetailView(record: KnowledgeBaseDetailRecord) {
    return {
      ...this.toKnowledgeBaseView(record),
      folders: record.folders,
      collections: record.collections.map((collection) => ({
        ...collection,
        counts: {
          documents: collection._count.documents,
        },
        _count: undefined,
      })),
    };
  }
}
