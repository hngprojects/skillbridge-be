import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthResult, AuthService } from '../auth/auth.service';
import { User } from '../users/entities/user.entity';
import { CompleteCandidateOnboardingDto } from './dto/complete-candidate-onboarding.dto';
import {
  CandidateProfile,
  CandidateProfileStatus,
} from './entities/candidate-profile.entity';

export type CandidateOnboardingResult = {
  message: string;
  user: AuthResult['data']['user'];
  profile: CandidateProfile;
  tokens: AuthResult['tokens'];
};

@Injectable()
export class CandidateService {
  constructor(
    @InjectRepository(CandidateProfile)
    private readonly candidateProfileRepository: Repository<CandidateProfile>,
    private readonly authService: AuthService,
  ) {}

  async completeOnboarding(
    userId: string,
    dto: CompleteCandidateOnboardingDto,
  ): Promise<CandidateOnboardingResult> {
    const profile = await this.candidateProfileRepository.manager.transaction(
      async (manager) => {
        const user = await manager.findOne(User, {
          where: { id: userId },
        });
        if (!user) {
          throw new ForbiddenException('Invalid user');
        }
        if (user.onboarding_complete) {
          throw new ForbiddenException('Onboarding already completed');
        }

        const existingProfile = await manager.findOne(CandidateProfile, {
          where: { user_id: userId },
        });
        if (existingProfile) {
          throw new ConflictException('Candidate profile already exists');
        }

        const nextProfile = manager.create(CandidateProfile, {
          user_id: userId,
          role_track: dto.roleTrack.trim(),
          bio: dto.bio?.trim() || null,
          status: CandidateProfileStatus.NOT_STARTED,
          profile_share_link: null,
          is_published: false,
          published_at: null,
        });

        const savedProfile = await manager.save(CandidateProfile, nextProfile);
        await manager.update(
          User,
          { id: userId },
          { onboarding_complete: true },
        );

        return savedProfile;
      },
    );

    const session = await this.authService.issueSessionForUser(
      userId,
      'Candidate onboarding completed',
    );

    return {
      message: session.message,
      user: session.data.user,
      profile,
      tokens: session.tokens,
    };
  }
}
