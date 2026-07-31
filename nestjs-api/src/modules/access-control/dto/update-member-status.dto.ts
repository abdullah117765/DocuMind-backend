import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { OrganizationMembershipStatus } from '../../../generated/prisma/client';

const MUTABLE_MEMBERSHIP_STATUSES = [
  OrganizationMembershipStatus.ACTIVE,
  OrganizationMembershipStatus.SUSPENDED,
] as const;

export class UpdateMemberStatusDto {
  @ApiProperty({
    description:
      'ACTIVE restores organization access; SUSPENDED temporarily revokes it while retaining role assignments',
    enum: MUTABLE_MEMBERSHIP_STATUSES,
    example: OrganizationMembershipStatus.SUSPENDED,
  })
  @IsIn(MUTABLE_MEMBERSHIP_STATUSES, {
    message: 'Member status must be ACTIVE or SUSPENDED',
  })
  status!:
    | typeof OrganizationMembershipStatus.ACTIVE
    | typeof OrganizationMembershipStatus.SUSPENDED;
}
