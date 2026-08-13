import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { PrismaModule } from '../prisma/prisma.module';
import { KnowledgeBasesController } from './knowledge-bases.controller';
import { KnowledgeBasesService } from './knowledge-bases.service';

@Module({
  imports: [AccessControlModule, PrismaModule],
  controllers: [KnowledgeBasesController],
  providers: [KnowledgeBasesService],
  exports: [KnowledgeBasesService],
})
export class KnowledgeBasesModule {}
