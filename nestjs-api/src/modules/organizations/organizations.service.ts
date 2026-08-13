import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  OrganizationMembershipStatus,
  OrganizationStatus,
  Prisma,
} from '../../generated/prisma/client';
import { AccessControlService } from '../access-control/access-control.service';
import {
  DocumentStorageService,
  StoredObjectReference,
} from '../documents/document-storage.service';
import { RagOrchestratorService } from '../documents/rag-orchestrator.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { ListOrganizationsQueryDto } from './dto/list-organizations-query.dto';
import { UpdateOrganizationSettingsDto } from './dto/update-organization-settings.dto';
import { UpdatePlatformOrganizationDto } from './dto/update-platform-organization.dto';

const MAX_SLUG_ATTEMPTS = 50;
const ORGANIZATION_NAME_PATTERN = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/;

const organizationSelect = {
  id: true,
  name: true,
  slug: true,
  createdByUserId: true,
  status: true,
  allowJoinRequests: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      memberships: {
        where: {
          status: {
            not: OrganizationMembershipStatus.REMOVED,
          },
        },
      },
    },
  },
} as const satisfies Prisma.OrganizationSelect;

type OrganizationRecord = Prisma.OrganizationGetPayload<{
  select: typeof organizationSelect;
}>;

export interface PlatformOrganizationView {
  id: string;
  name: string;
  slug: string;
  createdByUserId: string | null;
  status: OrganizationStatus;
  allowJoinRequests: boolean;
  createdAt: Date;
  updatedAt: Date;
  memberCount: number;
}

export interface PlatformOrganizationListResult {
  organizations: PlatformOrganizationView[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}

function normalizeOrganizationName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function assertCleanOrganizationName(name: string): void {
  if (!ORGANIZATION_NAME_PATTERN.test(name)) {
    throw new BadRequestException(
      'Organization name can contain only letters, numbers, and single spaces',
    );
  }
}

function buildSlugSeed(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 100)
    .replace(/-+$/g, '');

  return slug || 'organization';
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessControlService: AccessControlService,
    private readonly storageService: DocumentStorageService,
    private readonly ragOrchestrator: RagOrchestratorService,
  ) {}

  async listOrganizations(
    query: ListOrganizationsQueryDto = {},
  ): Promise<PlatformOrganizationListResult> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();
    const where: Prisma.OrganizationWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              {
                name: {
                  contains: search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
              {
                slug: {
                  contains: search,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            ],
          }
        : {}),
    };
    const orderBy = this.resolveOrganizationOrderBy(query.sort);
    const [total, organizations] = await Promise.all([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({
        where,
        select: organizationSelect,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      organizations: organizations.map((organization) =>
        this.toView(organization),
      ),
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.max(Math.ceil(total / pageSize), 1),
      },
    };
  }

  async getOrganization(
    organizationId: string,
  ): Promise<PlatformOrganizationView> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: organizationSelect,
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    return this.toView(organization);
  }

  async createOrganization(
    actorUserId: string,
    dto: CreateOrganizationDto,
  ): Promise<PlatformOrganizationView> {
    const name = normalizeOrganizationName(dto.name);
    assertCleanOrganizationName(name);
    const slugSeed = buildSlugSeed(dto.slug ?? name);
    const slug = dto.slug
      ? slugSeed
      : await this.resolveAvailableGeneratedSlug(slugSeed);

    try {
      const organization = await this.prisma.$transaction(
        async (transaction) => {
          const createdOrganization = await transaction.organization.create({
            data: {
              name,
              slug,
              createdByUserId: actorUserId,
              allowJoinRequests: dto.allowJoinRequests ?? true,
            },
            select: { id: true },
          });

          return transaction.organization.findUniqueOrThrow({
            where: { id: createdOrganization.id },
            select: organizationSelect,
          });
        },
      );

      await Promise.all([
        this.accessControlService.invalidateOrganizationAccess(organization.id),
      ]);

      return this.toView(organization);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Organization slug is already in use');
      }

      throw error;
    }
  }

  async updateOrganizationSettings(
    organizationId: string,
    dto: UpdateOrganizationSettingsDto,
  ): Promise<PlatformOrganizationView> {
    return this.updateOrganization(organizationId, dto);
  }

  async updatePlatformOrganization(
    organizationId: string,
    dto: UpdatePlatformOrganizationDto,
  ): Promise<PlatformOrganizationView> {
    return this.updateOrganization(organizationId, dto);
  }

  async deleteOrganization(
    organizationId: string,
    confirmation: string,
  ): Promise<void> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const normalizedConfirmation = confirmation.trim().toLowerCase();
    const matchesName =
      normalizedConfirmation === organization.name.trim().toLowerCase();
    const matchesSlug = normalizedConfirmation === organization.slug;

    if (!matchesName && !matchesSlug) {
      throw new BadRequestException(
        'Type the organization name or URL name to confirm deletion',
      );
    }

    const objectReferences =
      await this.collectOrganizationObjectReferences(organizationId);

    if (objectReferences.length > 0) {
      await this.storageService.removeObjects(objectReferences).catch((error) => {
        throw new ServiceUnavailableException(
          'Organization files could not be removed. Try again after document storage is available.',
          { cause: error },
        );
      });
    }

    try {
      await this.prisma.organization.delete({
        where: { id: organizationId },
      });
    } catch (error: unknown) {
      if (this.isMissingRecordError(error)) {
        throw new NotFoundException('Organization not found');
      }

      throw error;
    }

    await this.accessControlService.invalidateOrganizationAccess(
      organizationId,
    );
    void this.ragOrchestrator.deleteOrganization(organizationId);
  }

  private async collectOrganizationObjectReferences(
    organizationId: string,
  ): Promise<StoredObjectReference[]> {
    const [documents, stagedFiles] = await Promise.all([
      this.prisma.document.findMany({
        where: { organizationId },
        select: {
          storageBucket: true,
          storageKey: true,
          versions: {
            select: {
              storageBucket: true,
              storageKey: true,
            },
          },
        },
      }),
      this.prisma.documentUploadStagedFile.findMany({
        where: {
          uploadSession: {
            is: {
              organizationId,
            },
          },
        },
        select: {
          storageBucket: true,
          storageKey: true,
        },
      }),
    ]);
    const references = new Map<string, StoredObjectReference>();
    const addReference = (bucket: string, key: string): void => {
      references.set(`${bucket}/${key}`, { bucket, key });
    };

    for (const document of documents) {
      addReference(document.storageBucket, document.storageKey);

      for (const version of document.versions) {
        addReference(version.storageBucket, version.storageKey);
      }
    }

    for (const stagedFile of stagedFiles) {
      addReference(stagedFile.storageBucket, stagedFile.storageKey);
    }

    return [...references.values()];
  }

  private async updateOrganization(
    organizationId: string,
    dto: UpdateOrganizationSettingsDto & { status?: OrganizationStatus },
  ): Promise<PlatformOrganizationView> {
    const data: Prisma.OrganizationUpdateInput = {
      ...(dto.name
        ? (() => {
            const name = normalizeOrganizationName(dto.name);
            assertCleanOrganizationName(name);
            return { name };
          })()
        : {}),
      ...(dto.slug ? { slug: buildSlugSeed(dto.slug) } : {}),
      ...(dto.allowJoinRequests !== undefined
        ? { allowJoinRequests: dto.allowJoinRequests }
        : {}),
      ...(dto.status ? { status: dto.status } : {}),
    };

    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'At least one organization field is required',
      );
    }

    try {
      const organization = await this.prisma.organization.update({
        where: { id: organizationId },
        data,
        select: organizationSelect,
      });

      await this.accessControlService.invalidateOrganizationAccess(
        organizationId,
      );

      return this.toView(organization);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Organization slug is already in use');
      }

      if (this.isMissingRecordError(error)) {
        throw new NotFoundException('Organization not found');
      }

      throw error;
    }
  }

  private async resolveAvailableGeneratedSlug(seed: string): Promise<string> {
    for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS; attempt += 1) {
      const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
      const candidate = `${seed.slice(0, 100 - suffix.length)}${suffix}`;
      const existingOrganization = await this.prisma.organization.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });

      if (!existingOrganization) {
        return candidate;
      }
    }

    throw new ConflictException('Organization slug is already in use');
  }

  private toView(organization: OrganizationRecord): PlatformOrganizationView {
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      createdByUserId: organization.createdByUserId,
      status: organization.status,
      allowJoinRequests: organization.allowJoinRequests,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
      memberCount: organization._count.memberships,
    };
  }

  private resolveOrganizationOrderBy(
    sort?: 'name' | 'newest' | 'oldest',
  ): Prisma.OrganizationOrderByWithRelationInput[] {
    if (sort === 'newest') {
      return [{ createdAt: 'desc' }, { id: 'asc' }];
    }

    if (sort === 'oldest') {
      return [{ createdAt: 'asc' }, { id: 'asc' }];
    }

    return [{ name: 'asc' }, { id: 'asc' }];
  }

  private isMissingRecordError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    );
  }
}
