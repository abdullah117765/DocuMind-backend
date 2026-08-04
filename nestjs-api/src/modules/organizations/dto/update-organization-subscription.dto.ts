import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, type TransformFnParams } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsOptional,
  Matches,
  MaxLength,
} from 'class-validator';
import { SubscriptionStatus } from '../../../generated/prisma/client';

const SUBSCRIPTION_STATUSES = [
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
  SubscriptionStatus.CANCELED,
] as const;

export class UpdateOrganizationSubscriptionDto {
  @ApiPropertyOptional({
    description: 'Commercial plan code',
    example: 'PROFESSIONAL',
    maxLength: 40,
  })
  @Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsOptional()
  @MaxLength(40, { message: 'Plan must not exceed 40 characters' })
  @Matches(/^[A-Z][A-Z0-9_]*$/, {
    message: 'Plan must use uppercase letters, numbers, and underscores',
  })
  plan?: string;

  @ApiPropertyOptional({
    enum: SUBSCRIPTION_STATUSES,
    example: SubscriptionStatus.ACTIVE,
  })
  @IsOptional()
  @IsIn(SUBSCRIPTION_STATUSES, { message: 'Subscription status is invalid' })
  status?: SubscriptionStatus;

  @ApiPropertyOptional({
    description: 'Current billing period end as an ISO date-time',
    example: '2026-09-04T12:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601({}, { message: 'Current period end must be an ISO date-time' })
  currentPeriodEndsAt?: string | null;
}
