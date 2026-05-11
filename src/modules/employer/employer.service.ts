import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuthResult, AuthService } from '../auth/auth.service';
import {
  TalentProfile,
  TalentProfileStatus,
} from '../talent/entities/talent-profile.entity';
import { UsersService } from '../users/users.service';
import { CompleteEmployerOnboardingDto } from './dto/complete-employer-onboarding.dto';
import { DiscoveryQueryDto } from './dto/discovery-query.dto';
import { UpdateEmployerProfileDto } from './dto/update-employer-profile.dto';
import { ContactStatus, EmployerContact } from './entities/employer-contact.entity';
import { EmployerProfile } from './entities/employer-profile.entity';
import { Shortlist } from './entities/shortlist.entity';

export type EmployerOnboardingResult = {
  message: string;
  user: AuthResult['data']['user'];
  profile: EmployerProfile;
  tokens: AuthResult['tokens'];
};

export interface CandidateCard {
  id: string;
  roleTrack: string;
  status: TalentProfileStatus;
  bio: string | null;
  profileShareLink: string | null;
  publishedAt: Date | null;
  firstName: string;
  lastName: string;
  country: string;
  avatarUrl: string | null;
  isShortlisted: boolean;
  contactStatus: ContactStatus | null;
  createdAt: Date;
}

export interface PaginatedDiscovery {
  payload: CandidateCard[];
  paginationMeta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

@Injectable()
export class EmployerService {
  constructor(
    @InjectRepository(EmployerProfile)
    private readonly employerProfileRepository: Repository<EmployerProfile>,
    @InjectRepository(TalentProfile)
    private readonly talentProfileRepository: Repository<TalentProfile>,
    @InjectRepository(Shortlist)
    private readonly shortlistRepository: Repository<Shortlist>,
    @InjectRepository(EmployerContact)
    private readonly contactRepository: Repository<EmployerContact>,
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  async completeOnboarding(
    userId: string,
    dto: CompleteEmployerOnboardingDto,
  ): Promise<EmployerOnboardingResult> {
    const profile = await this.employerProfileRepository.manager.transaction(
      async (manager: EntityManager) => {
        let user;
        try {
          user = await this.usersService.getUserForOnboarding(manager, userId);
        } catch (error: unknown) {
          if (error instanceof NotFoundException) {
            throw new ForbiddenException('Invalid user');
          }
          throw error;
        }
        if (user.onboarding_complete) {
          throw new ForbiddenException('Onboarding already completed');
        }

        const existingProfile = await manager.findOne(EmployerProfile, {
          where: { user_id: userId },
        });
        if (existingProfile) {
          throw new ConflictException('Employer profile already exists');
        }

        const nextProfile = manager.create(EmployerProfile, {
          user_id: userId,
          company_name: dto.companyName.trim(),
          company_size: dto.companySize?.trim() || null,
          industry: dto.industry?.trim() || null,
          website_url: dto.websiteUrl?.trim() || null,
          company_description: dto.companyDescription?.trim() || null,
          hiring_region: dto.hiringRegion?.trim() || null,
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
      'Employer onboarding completed',
    );

    return {
      message: session.message,
      user: session.data.user,
      profile,
      tokens: session.tokens,
    };
  }

  async getProfile(userId: string): Promise<EmployerProfile> {
    const profile = await this.employerProfileRepository.findOne({
      where: { user_id: userId },
    });

    if (!profile) {
      throw new NotFoundException('Employer profile not found');
    }

    return profile;
  }

  async updateProfile(
    userId: string,
    dto: UpdateEmployerProfileDto,
  ): Promise<EmployerProfile> {
    const profile = await this.getProfile(userId);

    const updatePayload: Partial<EmployerProfile> = {};

    if (dto.companyName !== undefined) {
      updatePayload.company_name = dto.companyName.trim();
    }
    if (dto.companySize !== undefined) {
      updatePayload.company_size = dto.companySize.trim();
    }
    if (dto.industry !== undefined) {
      updatePayload.industry = dto.industry.trim();
    }
    if (dto.websiteUrl !== undefined) {
      updatePayload.website_url = dto.websiteUrl.trim();
    }
    if (dto.companyDescription !== undefined) {
      updatePayload.company_description = dto.companyDescription.trim();
    }
    if (dto.hiringRegion !== undefined) {
      updatePayload.hiring_region = dto.hiringRegion.trim();
    }

    this.employerProfileRepository.merge(profile, updatePayload);
    return this.employerProfileRepository.save(profile);
  }

  async discoverCandidates(
    userId: string,
    query: DiscoveryQueryDto,
  ): Promise<PaginatedDiscovery> {
    const employer = await this.getOnboardedEmployer(userId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const allowedStatuses = query.status
      ? [query.status]
      : [TalentProfileStatus.JOB_READY, TalentProfileStatus.EMERGING];

    const qb = this.talentProfileRepository
      .createQueryBuilder('cp')
      .innerJoinAndSelect('cp.user', 'u')
      .where('cp.is_published = :published', { published: true })
      .andWhere('cp.status IN (:...statuses)', { statuses: allowedStatuses });

    if (query.roleTrack) {
      qb.andWhere('LOWER(cp.role_track) = LOWER(:roleTrack)', {
        roleTrack: query.roleTrack,
      });
    }

    if (query.country) {
      qb.andWhere('LOWER(u.country) = LOWER(:country)', {
        country: query.country,
      });
    }

    qb.orderBy('cp.published_at', 'DESC').addOrderBy('cp.created_at', 'DESC');

    const total = await qb.getCount();

    qb.skip((page - 1) * limit).take(limit);

    const profiles: TalentProfile[] = await qb.getMany();

    const candidateIds = profiles.map((profile: TalentProfile) => profile.id);
    const [shortlistedIds, contactMap] = await Promise.all([
      this.resolveShortlistedIds(employer.id, candidateIds),
      this.resolveContactMap(employer.id, candidateIds),
    ]);

    const payload: CandidateCard[] = profiles.map((profile: TalentProfile) => ({
      id: profile.id,
      roleTrack: profile.role_track,
      status: profile.status,
      bio: profile.bio,
      profileShareLink: profile.profile_share_link,
      publishedAt: profile.published_at,
      firstName: profile.user.first_name,
      lastName: profile.user.last_name,
      country: profile.user.country,
      avatarUrl: profile.user.avatar_url,
      isShortlisted: shortlistedIds.has(profile.id),
      contactStatus: contactMap.get(profile.id) ?? null,
      createdAt: profile.created_at,
    }));

    return {
      payload,
      paginationMeta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getCandidateProfile(
    userId: string,
    candidateId: string,
  ): Promise<CandidateCard> {
    const employer = await this.getOnboardedEmployer(userId);

    const profile = await this.talentProfileRepository.findOne({
      where: { id: candidateId, is_published: true },
      relations: ['user'],
    });

    if (
      !profile ||
      ![TalentProfileStatus.EMERGING, TalentProfileStatus.JOB_READY].includes(
        profile.status,
      )
    ) {
      throw new NotFoundException('Candidate profile not found');
    }

    const [shortlistedIds, contactMap] = await Promise.all([
      this.resolveShortlistedIds(employer.id, [profile.id]),
      this.resolveContactMap(employer.id, [profile.id]),
    ]);

    return {
      id: profile.id,
      roleTrack: profile.role_track,
      status: profile.status,
      bio: profile.bio,
      profileShareLink: profile.profile_share_link,
      publishedAt: profile.published_at,
      firstName: profile.user.first_name,
      lastName: profile.user.last_name,
      country: profile.user.country,
      avatarUrl: profile.user.avatar_url,
      isShortlisted: shortlistedIds.has(profile.id),
      contactStatus: contactMap.get(profile.id) ?? null,
      createdAt: profile.created_at,
    };
  }

  async getShortlist(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<PaginatedDiscovery> {
    const employer = await this.getOnboardedEmployer(userId);

    const [entries, total] = await this.shortlistRepository.findAndCount({
      where: { employer_profile_id: employer.id },
      relations: ['candidateProfile', 'candidateProfile.user'],
      order: { saved_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    const candidateIds = entries.map((entry: Shortlist) => entry.candidate_profile_id);
    const contactMap = await this.resolveContactMap(employer.id, candidateIds);

    const payload: CandidateCard[] = entries.map((entry: Shortlist) => {
      const profile = entry.candidateProfile;
      return {
        id: profile.id,
        roleTrack: profile.role_track,
        status: profile.status,
        bio: profile.bio,
        profileShareLink: profile.profile_share_link,
        publishedAt: profile.published_at,
        firstName: profile.user.first_name,
        lastName: profile.user.last_name,
        country: profile.user.country,
        avatarUrl: profile.user.avatar_url,
        isShortlisted: true,
        contactStatus: contactMap.get(profile.id) ?? null,
        createdAt: profile.created_at,
      };
    });

    return {
      payload,
      paginationMeta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async addToShortlist(
    userId: string,
    candidateId: string,
  ): Promise<{ message: string; data: Shortlist }> {
    const employer = await this.getOnboardedEmployer(userId);

    await this.assertCandidateDiscoverable(candidateId);

    const existing = await this.shortlistRepository.findOne({
      where: { employer_profile_id: employer.id, candidate_profile_id: candidateId },
    });

    if (existing) {
      throw new ConflictException('Candidate is already in your shortlist');
    }

    const entry = await this.shortlistRepository.save(
      this.shortlistRepository.create({
        employer_profile_id: employer.id,
        candidate_profile_id: candidateId,
      }),
    );

    return { message: 'Candidate added to shortlist', data: entry };
  }

  async removeFromShortlist(
    userId: string,
    candidateId: string,
  ): Promise<{ message: string }> {
    const employer = await this.getOnboardedEmployer(userId);

    const entry = await this.shortlistRepository.findOne({
      where: { employer_profile_id: employer.id, candidate_profile_id: candidateId },
    });

    if (!entry) {
      throw new NotFoundException('Candidate not found in shortlist');
    }

    await this.shortlistRepository.remove(entry);
    return { message: 'Candidate removed from shortlist' };
  }

  async initiateContact(
    userId: string,
    candidateId: string,
  ): Promise<{ message: string; data: EmployerContact }> {
    const employer = await this.getOnboardedEmployer(userId);

    const candidate = await this.assertCandidateDiscoverable(candidateId);

    if (candidate.status !== TalentProfileStatus.JOB_READY) {
      throw new ForbiddenException(
        'Contact can only be initiated with Job Ready candidates',
      );
    }

    const existing = await this.contactRepository.findOne({
      where: { employer_profile_id: employer.id, candidate_profile_id: candidateId },
    });

    if (existing) {
      throw new ConflictException(
        'You have already initiated contact with this candidate',
      );
    }

    const contact = await this.contactRepository.save(
      this.contactRepository.create({
        employer_profile_id: employer.id,
        candidate_profile_id: candidateId,
        status: ContactStatus.PENDING,
      }),
    );

    return { message: 'Contact request sent', data: contact };
  }

  async getContacts(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<{
    payload: EmployerContact[];
    paginationMeta: { total: number; page: number; limit: number; totalPages: number };
  }> {
    const employer = await this.getOnboardedEmployer(userId);

    const [contacts, total] = await this.contactRepository.findAndCount({
      where: { employer_profile_id: employer.id },
      relations: ['candidateProfile', 'candidateProfile.user'],
      order: { initiated_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      payload: contacts,
      paginationMeta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  private async getOnboardedEmployer(userId: string): Promise<EmployerProfile> {
    const user = await this.usersService.findOne(userId);

    if (!user.onboarding_complete) {
      throw new ForbiddenException(
        'Complete employer onboarding before using discovery features',
      );
    }

    const profile = await this.employerProfileRepository.findOne({
      where: { user_id: userId },
    });

    if (!profile) {
      throw new NotFoundException(
        'Employer profile not found. Complete onboarding first.',
      );
    }

    return profile;
  }

  private async assertCandidateDiscoverable(
    candidateId: string,
  ): Promise<TalentProfile> {
    const profile = await this.talentProfileRepository.findOne({
      where: { id: candidateId, is_published: true },
    });

    if (
      !profile ||
      ![TalentProfileStatus.EMERGING, TalentProfileStatus.JOB_READY].includes(
        profile.status,
      )
    ) {
      throw new NotFoundException('Candidate profile not found');
    }

    return profile;
  }

  private async resolveShortlistedIds(
    employerProfileId: string,
    candidateProfileIds: string[],
  ): Promise<Set<string>> {
    if (!candidateProfileIds.length) return new Set();

    const rows = await this.shortlistRepository
      .createQueryBuilder('s')
      .select('s.candidate_profile_id', 'candidateProfileId')
      .where('s.employer_profile_id = :employerProfileId', {
        employerProfileId,
      })
      .andWhere('s.candidate_profile_id IN (:...ids)', { ids: candidateProfileIds })
      .getRawMany<{ candidateProfileId: string }>();

    return new Set(rows.map((row: { candidateProfileId: string }) => row.candidateProfileId));
  }

  private async resolveContactMap(
    employerProfileId: string,
    candidateProfileIds: string[],
  ): Promise<Map<string, ContactStatus>> {
    if (!candidateProfileIds.length) return new Map();

    const rows = await this.contactRepository
      .createQueryBuilder('c')
      .select('c.candidate_profile_id', 'candidateProfileId')
      .addSelect('c.status', 'status')
      .where('c.employer_profile_id = :employerProfileId', {
        employerProfileId,
      })
      .andWhere('c.candidate_profile_id IN (:...ids)', { ids: candidateProfileIds })
      .getRawMany<{ candidateProfileId: string; status: ContactStatus }>();

    return new Map(
      rows.map((row: { candidateProfileId: string; status: ContactStatus }) => [
        row.candidateProfileId,
        row.status,
      ]),
    );
  }
}
