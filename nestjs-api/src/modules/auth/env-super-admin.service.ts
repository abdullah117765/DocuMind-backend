import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { SuperAdminConfiguration } from '../../config/super-admin.config';
import { AccessScope, User } from '../../generated/prisma/client';
import { PLATFORM_ROLE_KEYS } from '../access-control/rbac.constants';
import { PrismaService } from '../prisma/prisma.service';

export const ENV_SUPER_ADMIN_ROLE_ID =
  '00000000-0000-4000-8000-000000000001';

const ENV_ONLY_PASSWORD_HASH_PLACEHOLDER =
  '$2b$12$puR9afvrAILWKKnVKbDCX.0CXlT.969TXmlk0BC2aAbR/9yjc5..y';

export interface EnvSuperAdminProfile {
  id: typeof ENV_SUPER_ADMIN_ROLE_ID;
  name: string;
  scope: AccessScope;
}

type MinimalUser = Pick<User, 'id' | 'email'>;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

@Injectable()
export class EnvSuperAdminService {
  private readonly config: SuperAdminConfiguration;
  private configuredUserId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.config =
      configService.get<SuperAdminConfiguration>('superAdmin') ?? {
        configured: false,
        email: null,
        password: null,
        name: null,
      };
  }

  isConfigured(): boolean {
    return this.config.configured;
  }

  isConfiguredEmail(email: string): boolean {
    return (
      this.config.configured &&
      this.config.email === normalizeEmail(email)
    );
  }

  isConfiguredUser(user: MinimalUser): boolean {
    return this.isConfiguredEmail(user.email);
  }

  async isConfiguredUserId(userId: string): Promise<boolean> {
    if (!this.config.configured) {
      return false;
    }

    if (this.configuredUserId === userId) {
      return true;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user || !this.isConfiguredUser(user)) {
      return false;
    }

    this.configuredUserId = user.id;

    return true;
  }

  authenticate(email: string, password: string): Promise<User | null> {
    if (
      !this.config.configured ||
      !this.config.email ||
      !this.config.password ||
      !this.isConfiguredEmail(email) ||
      !safeEquals(this.config.password, password)
    ) {
      return Promise.resolve(null);
    }

    return this.ensureUserRecord();
  }

  getDisplayName(): string | null {
    return this.config.name;
  }

  getConfiguredEmail(): string | null {
    return this.config.email;
  }

  getVirtualRole(): EnvSuperAdminProfile | null {
    if (!this.config.configured || !this.config.name) {
      return null;
    }

    return {
      id: ENV_SUPER_ADMIN_ROLE_ID,
      name: 'Super Admin',
      scope: AccessScope.PLATFORM,
    };
  }

  getSessionUserMetadata(user: MinimalUser): {
    isSuperAdmin: true;
    name: string;
  } | null {
    if (!this.config.configured || !this.config.name || !this.isConfiguredUser(user)) {
      return null;
    }

    return {
      isSuperAdmin: true,
      name: this.config.name,
    };
  }

  async listActivePermissionCodes(scope: AccessScope): Promise<string[]> {
    if (!this.config.configured) {
      return [];
    }

    const permissions = await this.prisma.permission.findMany({
      where: {
        scope,
        isActive: true,
      },
      select: {
        code: true,
      },
      orderBy: {
        code: 'asc',
      },
    });

    return permissions.map((permission) => permission.code);
  }

  async ensureUserRecord(): Promise<User> {
    if (!this.config.configured || !this.config.email) {
      throw new Error(
        'SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, and SUPER_ADMIN_NAME are required for the environment Super Admin.',
      );
    }

    const user = await this.prisma.$transaction(async (transaction) => {
      const superAdminUser = await transaction.user.upsert({
        where: { email: this.config.email as string },
        update: {
          name: this.config.name,
          isVerified: true,
          isActive: true,
          deactivatedAt: null,
        },
        create: {
          name: this.config.name,
          email: this.config.email as string,
          passwordHash: ENV_ONLY_PASSWORD_HASH_PLACEHOLDER,
          isVerified: true,
          isActive: true,
        },
      });

      await transaction.platformUserRole.deleteMany({
        where: {
          OR: [
            { userId: superAdminUser.id },
            {
              role: {
                is: {
                  systemKey: PLATFORM_ROLE_KEYS.superAdmin,
                  scope: AccessScope.PLATFORM,
                },
              },
            },
          ],
        },
      });

      await transaction.membershipRole.deleteMany({
        where: {
          membership: {
            is: {
              userId: superAdminUser.id,
            },
          },
        },
      });

      await transaction.organizationMembership.deleteMany({
        where: {
          userId: superAdminUser.id,
        },
      });

      return superAdminUser;
    });

    this.configuredUserId = user.id;

    return user;
  }
}
