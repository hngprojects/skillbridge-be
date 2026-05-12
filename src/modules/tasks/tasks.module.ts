import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TaskSubmission } from './entities/task-submission.entity';
import { Assessment } from '../assessment/entities/assessment.entity';
import { TalentProfile } from '../talent/entities/talent-profile.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TaskSubmission, Assessment, TalentProfile]),
    UploadModule,
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
