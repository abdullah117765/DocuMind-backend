import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { JoinRequestStatus } from '../../../generated/prisma/client';

export class ListJoinRequestsQueryDto {
  @ApiPropertyOptional({ enum: JoinRequestStatus })
  @IsOptional()
  @IsIn(Object.values(JoinRequestStatus), {
    message: 'Status must be a valid join request status',
  })
  status?: JoinRequestStatus;
}
