import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthResult, AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';
import { CompleteTalentOnboardingDto } from './dto/complete-talent-onboarding.dto';
import { SetGoalDto } from './dto/set-goal.dto';
import { SetTracksDto } from './dto/set-tracks.dto';
import { SetProfileDto } from './dto/set-profile.dto';
import {
  TalentProfile,
  TalentProfileStatus,
} from './entities/talent-profile.entity';
import {
  ConflictError,
  ErrorMessages,
  ForbiddenError,
  SuccessMessages,
} from '../../shared';

export type TalentOnboardingResult = {
  message: string;
  user: AuthResult['data']['user'];
  profile: TalentProfile;
  tokens: AuthResult['tokens'];
};

export type TalentStepResult = {
  message: string;
  profile: TalentProfile;
};

@Injectable()
export class TalentService {
  constructor(
    @InjectRepository(TalentProfile)
    private readonly talentProfileRepository: Repository<TalentProfile>,
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  /** Find or create a talent profile for the given user (upsert helper). */
  private async findOrCreateProfile(userId: string): Promise<TalentProfile> {
    const existing = await this.talentProfileRepository.findOne({
      where: { user_id: userId },
    });
    if (existing) return existing;

    const created = this.talentProfileRepository.create({
      user_id: userId,
      role_track: null,
      role_tracks: null,
      goal: null,
      region: null,
      education_level: null,
      linkedin_url: null,
      onboarding_step: 0,
      status: TalentProfileStatus.NOT_STARTED,
      bio: null,
      profile_share_link: null,
      is_published: false,
      published_at: null,
    });
    return this.talentProfileRepository.save(created);
  }

  async updateUserAvatar(userId: string, avatarUrl: string): Promise<void> {
    await this.usersService.updateAvatar(userId, avatarUrl);
  }

  async getOnboardingState(userId: string): Promise<{ profile: TalentProfile | null; user: { id: string; email: string; first_name: string; last_name: string; avatar_url: string | null } }> {
    const user = await this.usersService.findOne(userId);
    const profile = await this.talentProfileRepository.findOne({
      where: { user_id: userId },
    });
    return {
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        avatar_url: user.avatar_url,
      },
      profile,
    };
  }

  async saveGoal(userId: string, dto: SetGoalDto): Promise<TalentStepResult> {
    const user = await this.usersService.findOne(userId);
    if (user.onboarding_complete) {
      throw new ForbiddenError(ErrorMessages.ONBOARDING.ALREADY_COMPLETED);
    }

    const profile = await this.findOrCreateProfile(userId);
    profile.goal = dto.goal;
    if (profile.onboarding_step < 1) profile.onboarding_step = 1;

    const saved = await this.talentProfileRepository.save(profile);
    return { message: SuccessMessages.ONBOARDING.GOAL_SAVED, profile: saved };
  }

  async saveTracks(userId: string, dto: SetTracksDto): Promise<TalentStepResult> {
    const user = await this.usersService.findOne(userId);
    if (user.onboarding_complete) {
      throw new ForbiddenError(ErrorMessages.ONBOARDING.ALREADY_COMPLETED);
    }

    const profile = await this.findOrCreateProfile(userId);
    profile.role_tracks = dto.roleTracks;
    if (profile.onboarding_step < 2) profile.onboarding_step = 2;

    const saved = await this.talentProfileRepository.save(profile);
    return { message: SuccessMessages.ONBOARDING.TRACKS_SAVED, profile: saved };
  }

  async saveProfile(
    userId: string,
    dto: SetProfileDto,
  ): Promise<TalentOnboardingResult> {
    const profile = await this.talentProfileRepository.manager.transaction(
      async (manager) => {
        let user;
        try {
          user = await this.usersService.getUserForOnboarding(manager, userId);
        } catch (error: unknown) {
          if (error instanceof NotFoundException) {
            throw new ForbiddenError(ErrorMessages.ONBOARDING.INVALID_USER);
          }
          throw error;
        }
        if (user.onboarding_complete) {
          throw new ForbiddenError(ErrorMessages.ONBOARDING.ALREADY_COMPLETED);
        }

        let talentProfile = await manager.findOne(TalentProfile, {
          where: { user_id: userId },
        });
        if (!talentProfile) {
          talentProfile = manager.create(TalentProfile, {
            user_id: userId,
            status: TalentProfileStatus.NOT_STARTED,
            is_published: false,
          });
        }

        talentProfile.region = dto.region;
        talentProfile.education_level = dto.educationLevel;
        talentProfile.linkedin_url = dto.linkedinUrl ?? null;
        talentProfile.onboarding_step = 3;

        if (dto.avatarUrl) {
          await manager.update(User, { id: userId }, { avatar_url: dto.avatarUrl });
        }

        const savedProfile = await manager.save(TalentProfile, talentProfile);
        await this.usersService.markOnboardingCompleteWithManager(manager, userId);

        return savedProfile;
      },
    );

    const session = await this.authService.issueSessionForUser(
      userId,
      SuccessMessages.ONBOARDING.PROFILE_SAVED,
    );

    return {
      message: session.message,
      user: session.data.user,
      profile,
      tokens: session.tokens,
    };
  }

  /** Legacy single-step onboarding — kept for backward compatibility. */
  async completeOnboarding(
    userId: string,
    dto: CompleteTalentOnboardingDto,
  ): Promise<TalentOnboardingResult> {
    const profile = await this.talentProfileRepository.manager.transaction(
      async (manager) => {
        let user;
        try {
          user = await this.usersService.getUserForOnboarding(manager, userId);
        } catch (error: unknown) {
          if (error instanceof NotFoundException) {
            throw new ForbiddenError(ErrorMessages.ONBOARDING.INVALID_USER);
          }
          throw error;
        }
        if (user.onboarding_complete) {
          throw new ForbiddenError(ErrorMessages.ONBOARDING.ALREADY_COMPLETED);
        }

        const existingProfile = await manager.findOne(TalentProfile, {
          where: { user_id: userId },
        });
        if (existingProfile) {
          throw new ConflictError(ErrorMessages.ONBOARDING.TALENT_PROFILE_EXISTS);
        }

        const nextProfile = manager.create(TalentProfile, {
          user_id: userId,
          role_track: dto.roleTrack.trim(),
          bio: dto.bio?.trim() || null,
          status: TalentProfileStatus.NOT_STARTED,
          profile_share_link: null,
          is_published: false,
          published_at: null,
        });

        const savedProfile = await manager.save(TalentProfile, nextProfile);
        await this.usersService.markOnboardingCompleteWithManager(
          manager,
          userId,
        );

        return savedProfile;
      },
    );

    const session = await this.authService.issueSessionForUser(
      userId,
      SuccessMessages.ONBOARDING.TALENT_COMPLETED,
    );

    return {
      message: session.message,
      user: session.data.user,
      profile,
      tokens: session.tokens,
    };
  }
}
