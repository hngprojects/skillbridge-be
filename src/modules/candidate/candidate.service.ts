import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthResult, AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
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
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {}

  async completeOnboarding(
    userId: string,
    dto: CompleteCandidateOnboardingDto,
  ): Promise<CandidateOnboardingResult> {
    const user = await this.usersService.findOne(userId);
    if (user.onboarding_complete) {
      throw new ForbiddenException('Onboarding already completed');
    }

    const existingProfile = await this.candidateProfileRepository.findOne({
      where: { user_id: userId },
    });
    if (existingProfile) {
      throw new ConflictException('Candidate profile already exists');
    }

    const profile = await this.candidateProfileRepository.save(
      this.candidateProfileRepository.create({
        user_id: userId,
        role_track: dto.roleTrack.trim(),
        bio: dto.bio?.trim() || null,
        status: CandidateProfileStatus.NOT_STARTED,
        profile_share_link: null,
        is_published: false,
        published_at: null,
      }),
    );

    await this.usersService.markOnboardingComplete(userId);
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
