import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TalentModule } from '../talent/talent.module';
import { AssessmentController } from './assessment.controller';
import { AssessmentService } from './assessment.service';
import { AssessmentEligibility } from './entities/assessment-eligibility.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AssessmentEligibility]), TalentModule],
  controllers: [AssessmentController],
  providers: [AssessmentService],
  exports: [AssessmentService],
})
export class AssessmentModule {}
