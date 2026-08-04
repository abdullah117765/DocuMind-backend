import { Injectable } from '@nestjs/common';
import { SubscriptionStatus } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateOrganizationLimitsDto } from './dto/update-organization-limits.dto';
import { UpdateOrganizationSubscriptionDto } from './dto/update-organization-subscription.dto';
import {
  DEFAULT_ORGANIZATION_LIMITS,
  DEFAULT_ORGANIZATION_SUBSCRIPTION,
} from './organization-defaults';

export interface OrganizationSubscriptionView {
  organizationId: string;
  plan: string;
  status: SubscriptionStatus;
  currentPeriodEndsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationLimitsView {
  organizationId: string;
  maxMembers: number;
  maxDocuments: number;
  maxStorageMb: number;
  maxMonthlyAiRequests: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class OrganizationBillingService {
  constructor(private readonly prisma: PrismaService) {}

  async getSubscription(
    organizationId: string,
  ): Promise<OrganizationSubscriptionView> {
    const subscription = await this.prisma.organizationSubscription.upsert({
      where: { organizationId },
      create: {
        organizationId,
        ...DEFAULT_ORGANIZATION_SUBSCRIPTION,
      },
      update: {},
    });

    return this.toSubscriptionView(subscription);
  }

  async updateSubscription(
    organizationId: string,
    dto: UpdateOrganizationSubscriptionDto,
  ): Promise<OrganizationSubscriptionView> {
    const subscription = await this.prisma.organizationSubscription.upsert({
      where: { organizationId },
      create: {
        organizationId,
        plan: dto.plan ?? DEFAULT_ORGANIZATION_SUBSCRIPTION.plan,
        status: dto.status ?? DEFAULT_ORGANIZATION_SUBSCRIPTION.status,
        currentPeriodEndsAt: dto.currentPeriodEndsAt
          ? new Date(dto.currentPeriodEndsAt)
          : null,
      },
      update: {
        ...(dto.plan ? { plan: dto.plan } : {}),
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.currentPeriodEndsAt !== undefined
          ? {
              currentPeriodEndsAt: dto.currentPeriodEndsAt
                ? new Date(dto.currentPeriodEndsAt)
                : null,
            }
          : {}),
      },
    });

    return this.toSubscriptionView(subscription);
  }

  async getLimits(organizationId: string): Promise<OrganizationLimitsView> {
    const limits = await this.prisma.organizationLimit.upsert({
      where: { organizationId },
      create: {
        organizationId,
        ...DEFAULT_ORGANIZATION_LIMITS,
      },
      update: {},
    });

    return this.toLimitsView(limits);
  }

  async updateLimits(
    organizationId: string,
    dto: UpdateOrganizationLimitsDto,
  ): Promise<OrganizationLimitsView> {
    const limits = await this.prisma.organizationLimit.upsert({
      where: { organizationId },
      create: {
        organizationId,
        ...DEFAULT_ORGANIZATION_LIMITS,
        ...dto,
      },
      update: dto,
    });

    return this.toLimitsView(limits);
  }

  private toSubscriptionView(subscription: {
    organizationId: string;
    plan: string;
    status: SubscriptionStatus;
    currentPeriodEndsAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): OrganizationSubscriptionView {
    return {
      organizationId: subscription.organizationId,
      plan: subscription.plan,
      status: subscription.status,
      currentPeriodEndsAt: subscription.currentPeriodEndsAt,
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
    };
  }

  private toLimitsView(limits: {
    organizationId: string;
    maxMembers: number;
    maxDocuments: number;
    maxStorageMb: number;
    maxMonthlyAiRequests: number;
    createdAt: Date;
    updatedAt: Date;
  }): OrganizationLimitsView {
    return {
      organizationId: limits.organizationId,
      maxMembers: limits.maxMembers,
      maxDocuments: limits.maxDocuments,
      maxStorageMb: limits.maxStorageMb,
      maxMonthlyAiRequests: limits.maxMonthlyAiRequests,
      createdAt: limits.createdAt,
      updatedAt: limits.updatedAt,
    };
  }
}
