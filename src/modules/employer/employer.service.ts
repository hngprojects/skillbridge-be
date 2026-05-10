import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthResult, AuthService } from '../auth/auth.service';
import { User } from '../users/entities/user.entity';
import { CompleteEmployerOnboardingDto } from './dto/complete-employer-onboarding.dto';
import { EmployerProfile } from './entities/employer-profile.entity';

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
  ) {}

  async completeOnboarding(
    userId: string,
    dto: CompleteEmployerOnboardingDto,
  ): Promise<EmployerOnboardingResult> {
    const profile = await this.employerProfileRepository.manager.transaction(
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
      'Employer onboarding completed',
    );

    return {
      message: session.message,
      user: session.data.user,
      profile,
      tokens: session.tokens,
    };
  }
}
