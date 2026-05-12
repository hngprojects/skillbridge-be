import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthResult, AuthService } from '../auth/auth.service';
import { TalentProfileStatus } from '../talent/entities/talent-profile.entity';
import { TalentService } from '../talent/talent.service';
import { UsersService } from '../users/users.service';
import { CompleteEmployerOnboardingDto } from './dto/complete-employer-onboarding.dto';
import { GetEmployerShortlistQueryDto } from './dto/get-employer-shortlist-query.dto';
import { SaveEmployerProfileDto } from './dto/save-employer-profile.dto';
import { EmployerProfile } from './entities/employer-profile.entity';
import { Shortlist } from './entities/shortlist.entity';
import { ShortlistRepository } from './repositories/shortlist.repository';
import { EmployerShortlistItem } from './types/employer-shortlist-item.type';
import {
  BadRequestError,
  ConflictError,
  ErrorMessages,
  ForbiddenError,
  NotFoundError,
  SuccessMessages,
} from '../../shared';

export type EmployerOnboardingResult = {
  message: string;
  user: AuthResult['data']['user'];
  profile: EmployerProfile;
  tokens: AuthResult['tokens'];
};

@Injectable()
export class EmployerService {
  constructor(
    @InjectRepository(EmployerProfile)
    private readonly employerProfileRepository: Repository<EmployerProfile>,
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
    private readonly talentService: TalentService,
    private readonly shortlistRepository: ShortlistRepository,
  ) {}

  async saveProfile(
    userId: string,
    dto: SaveEmployerProfileDto,
  ): Promise<{ status: string; message: string }> {
    await this.employerProfileRepository.manager.transaction(async (manager) => {
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

      let profile = await manager.findOne(EmployerProfile, {
        where: { user_id: userId },
      });
      if (!profile) {
        profile = manager.create(EmployerProfile, { user_id: userId });
      }

      profile.employer_type = dto.employerType;
      profile.company_name = dto.companyName.trim();
      profile.company_size = dto.companySize;
      profile.company_website = dto.companyWebsite?.trim() ?? null;
      profile.hiring_roles = dto.hiringRoles;
      profile.hiring_locations = dto.hiringLocations;

      await manager.save(EmployerProfile, profile);
      await this.usersService.markOnboardingCompleteWithManager(manager, userId);
    });

    return { status: 'success', message: SuccessMessages.ONBOARDING.EMPLOYER_PROFILE_SAVED };
  }

  async completeOnboarding(
    userId: string,
    dto: CompleteEmployerOnboardingDto,
  ): Promise<EmployerOnboardingResult> {
    const profile = await this.employerProfileRepository.manager.transaction(
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

        const existingProfile = await manager.findOne(EmployerProfile, {
          where: { user_id: userId },
        });
        if (existingProfile) {
          throw new ConflictError(ErrorMessages.ONBOARDING.EMPLOYER_PROFILE_EXISTS);
        }

        const nextProfile = manager.create(EmployerProfile, {
          user_id: userId,
          joining_as: dto.joiningAs,
          desired_roles: dto.desiredRoles,
          region: dto.region.trim(),
          hiring_count_range: dto.hiringCountRange,
          company_website: dto.companyWebsite?.trim() || null,
        });

        const savedProfile = await manager.save(EmployerProfile, nextProfile);
        await this.usersService.markOnboardingCompleteWithManager(
          manager,
          userId,
        );

        return savedProfile;
      },
    );

    const session = await this.authService.issueSessionForUser(
      userId,
      SuccessMessages.ONBOARDING.EMPLOYER_COMPLETED,
    );

    return {
      message: session.message,
      user: session.data.user,
      profile,
      tokens: session.tokens,
    };
  }

  async addToShortlist(
    employerId: string,
    talentId: string,
  ): Promise<{
    status: string;
    message: string;
    data: { candidateId: string; shortlistedAt: string };
  }> {
    const talent = await this.talentService.findById(talentId);
    if (!talent) {
      throw new NotFoundError(ErrorMessages.SHORTLIST.CANDIDATE_NOT_FOUND);
    }

    if (talent.status !== TalentProfileStatus.JOB_READY) {
      throw new BadRequestError(ErrorMessages.SHORTLIST.CANDIDATE_NOT_JOB_READY);
    }

    const existingShortlist =
      await this.shortlistRepository.findByEmployerAndCandidate(
        employerId,
        talentId,
      );
    if (existingShortlist) {
      throw new ConflictError(ErrorMessages.SHORTLIST.DUPLICATE_ENTRY);
    }

    const shortlist = await this.shortlistRepository.create(
      employerId,
      talentId,
    );

    return {
      status: 'success',
      message: SuccessMessages.SHORTLIST.CANDIDATE_ADDED,
      data: {
        candidateId: talentId,
        shortlistedAt: shortlist.saved_at.toISOString(),
      },
    };
  }

  async removeFromShortlist(
    employerId: string,
    candidateId: string,
  ): Promise<{ status: string; message: string }> {
    const shortlist = await this.shortlistRepository.findByEmployerAndCandidate(
      employerId,
      candidateId,
    );
    if (!shortlist) {
      throw new NotFoundError(ErrorMessages.SHORTLIST.ENTRY_NOT_FOUND);
    }

    await this.shortlistRepository.deleteByEmployerAndCandidate(
      employerId,
      candidateId,
    );

    return {
      status: 'success',
      message: SuccessMessages.SHORTLIST.CANDIDATE_REMOVED,
    };
  }

  async getShortlist(
    employerId: string,
    query: GetEmployerShortlistQueryDto,
  ): Promise<{
    status: string;
    paginationMeta: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
    payload: EmployerShortlistItem[];
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sort = query.sort ?? 'shortlistedAt';
    const order = query.order ?? 'desc';

    const { items, total } = await this.shortlistRepository.findByEmployer(
      employerId,
      { page, limit, sort, order },
    );

    return {
      status: 'success',
      paginationMeta: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
      payload: items.map((shortlist) => this.mapShortlistItem(shortlist)),
    };
  }

  private mapShortlistItem(shortlist: Shortlist): EmployerShortlistItem {
    const candidate = shortlist.candidate;
    const user = candidate.user;

    return {
      candidateId: shortlist.candidate_id,
      fullName: `${user.first_name} ${user.last_name}`.trim(),
      roleTrack: this.formatRoleTrack(candidate.track ?? candidate.role_track),
      tier: this.formatTier(candidate.status),
      compositeScore: null,
      shortlistedAt: shortlist.saved_at.toISOString(),
    };
  }

  private formatRoleTrack(track: string | null): string | null {
    if (!track) {
      return null;
    }

    return track
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ');
  }

  private formatTier(status: TalentProfileStatus): string {
    switch (status) {
      case TalentProfileStatus.JOB_READY:
        return 'Job Ready';
      case TalentProfileStatus.EMERGING:
        return 'Emerging';
      case TalentProfileStatus.NOT_READY:
        return 'Not Ready';
      case TalentProfileStatus.IN_PROGRESS:
        return 'In Progress';
      case TalentProfileStatus.NOT_STARTED:
      default:
        return 'Not Started';
    }
  }
}
