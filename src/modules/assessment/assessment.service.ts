import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AssessmentEligibility,
  AssessmentEligibilityStatus,
} from './entities/assessment-eligibility.entity';
import { TalentProfile } from '../talent/entities/talent-profile.entity';
import {
  ErrorMessages,
  ForbiddenError,
  ConflictError,
  BadRequestError,
} from '../../shared';

@Injectable()
export class AssessmentService {
  constructor(
    @InjectRepository(AssessmentEligibility)
    private readonly eligibilityRepository: Repository<AssessmentEligibility>,
    @InjectRepository(TalentProfile)
    private readonly talentProfileRepository: Repository<TalentProfile>,
  ) {}

  private async getTalentProfile(userId: string): Promise<TalentProfile> {
    const profile = await this.talentProfileRepository.findOne({
      where: { user_id: userId },
    });
    if (!profile) {
      throw new ForbiddenError(ErrorMessages.ASSESSMENT.ONBOARDING_INCOMPLETE);
    }
    return profile;
  }

  async getEligibility(userId: string) {
    const profile = await this.getTalentProfile(userId);

    let eligibility = await this.eligibilityRepository.findOne({
      where: { talent_id: profile.id },
    });

    if (!eligibility) {
      eligibility = this.eligibilityRepository.create({
        talent_id: profile.id,
        status: profile.profile_verified
          ? AssessmentEligibilityStatus.ELIGIBLE
          : AssessmentEligibilityStatus.UNINITIALIZED,
      });
      await this.eligibilityRepository.save(eligibility);
    } else if (
      eligibility.status === AssessmentEligibilityStatus.UNINITIALIZED &&
      profile.profile_verified
    ) {
      eligibility.status = AssessmentEligibilityStatus.ELIGIBLE;
      await this.eligibilityRepository.save(eligibility);
    }

    if (
      eligibility.status === AssessmentEligibilityStatus.LOCKED_OUT &&
      eligibility.retake_eligible_at
    ) {
      const now = new Date();
      if (now >= eligibility.retake_eligible_at) {
        eligibility.status = AssessmentEligibilityStatus.ELIGIBLE;
        eligibility.retake_eligible_at = null;
        await this.eligibilityRepository.save(eligibility);
      }
    }

    return {
      is_onboarding_complete: profile.profile_verified,
      eligibility_status: eligibility.status,
      retake_eligible_at: eligibility.retake_eligible_at,
      attempts_count: eligibility.attempts_count,
    };
  }

  async startAssessment(userId: string) {
    const profile = await this.getTalentProfile(userId);
    if (!profile.profile_verified) {
      throw new ForbiddenError(ErrorMessages.ASSESSMENT.ONBOARDING_INCOMPLETE);
    }

    const eligibility = await this.eligibilityRepository.findOne({
      where: { talent_id: profile.id },
    });

    if (
      !eligibility ||
      eligibility.status === AssessmentEligibilityStatus.UNINITIALIZED
    ) {
      throw new ForbiddenError(ErrorMessages.ASSESSMENT.ONBOARDING_INCOMPLETE);
    }

    if (eligibility.status === AssessmentEligibilityStatus.LOCKED_OUT) {
      const now = new Date();
      if (
        eligibility.retake_eligible_at &&
        now < eligibility.retake_eligible_at
      ) {
        throw new ForbiddenError(ErrorMessages.ASSESSMENT.LOCKED);
      }
    }

    if (eligibility.status === AssessmentEligibilityStatus.IN_PROGRESS) {
      throw new ConflictError(ErrorMessages.ASSESSMENT.IN_PROGRESS);
    }

    eligibility.status = AssessmentEligibilityStatus.IN_PROGRESS;
    eligibility.last_attempt_at = new Date();
    eligibility.attempts_count += 1;
    await this.eligibilityRepository.save(eligibility);

    return {
      session_id: 'simulated-session-' + Date.now(),
    };
  }

  async submitAssessment(userId: string, result: 'PASSED' | 'FAILED') {
    const profile = await this.getTalentProfile(userId);
    const eligibility = await this.eligibilityRepository.findOne({
      where: { talent_id: profile.id },
    });

    if (
      !eligibility ||
      eligibility.status !== AssessmentEligibilityStatus.IN_PROGRESS
    ) {
      throw new BadRequestError(ErrorMessages.ASSESSMENT.INVALID_STATE_TRANSITION);
    }

    if (result === 'PASSED') {
      eligibility.status = AssessmentEligibilityStatus.PASSED;
      eligibility.retake_eligible_at = null;
    } else {
      eligibility.status = AssessmentEligibilityStatus.LOCKED_OUT;
      const lockoutDate = new Date();
      lockoutDate.setDate(lockoutDate.getDate() + 14); // 14 days cool-off
      eligibility.retake_eligible_at = lockoutDate;
    }

    await this.eligibilityRepository.save(eligibility);

    return {
      new_status: eligibility.status,
      retake_eligible_at: eligibility.retake_eligible_at,
    };
  }
}
