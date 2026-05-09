import {
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { env } from '../src/config/env';
import { CandidateController } from '../src/modules/candidate/candidate.controller';
import { CandidateService } from '../src/modules/candidate/candidate.service';
import {
  CandidateProfile,
  CandidateProfileStatus,
} from '../src/modules/candidate/entities/candidate-profile.entity';
import { EmployerController } from '../src/modules/employer/employer.controller';
import { EmployerService } from '../src/modules/employer/employer.service';
import { EmployerProfile } from '../src/modules/employer/entities/employer-profile.entity';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '../src/modules/auth/auth.cookies';
import { AuthService } from '../src/modules/auth/auth.service';
import { VerificationOtpService } from '../src/modules/auth/verification-otp.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../src/modules/auth/guards/roles.guard';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import { MailService } from '../src/modules/mail/mail.service';
import { User, UserRole } from '../src/modules/users/entities/user.entity';
import { UsersService } from '../src/modules/users/users.service';

type CandidateUser = User & { role: UserRole.CANDIDATE };
type EmployerUser = User & { role: UserRole.EMPLOYER };

class InMemoryUsersService {
  private readonly usersById = new Map<string, User>();

  constructor() {
    this.seedUser({
      id: 'candidate-user',
      email: 'candidate@example.com',
      first_name: 'Casey',
      last_name: 'Candidate',
      country: 'Nigeria',
      role: UserRole.CANDIDATE,
    });
    this.seedUser({
      id: 'employer-user',
      email: 'employer@example.com',
      first_name: 'Efe',
      last_name: 'Employer',
      country: 'Nigeria',
      role: UserRole.EMPLOYER,
    });
  }

  private seedUser(input: {
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    country: string;
    role: UserRole;
  }): void {
    const user = Object.assign(new User(), {
      ...input,
      password: null,
      avatar_url: null,
      is_verified: true,
      onboarding_complete: false,
      refreshTokenHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });
    this.usersById.set(user.id, user);
  }

  async findOne(id: string): Promise<User> {
    const user = this.usersById.get(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  findOneOrNull(id: string): Promise<User | null> {
    return Promise.resolve(this.usersById.get(id) ?? null);
  }

  async markOnboardingComplete(id: string): Promise<User> {
    const user = await this.findOne(id);
    user.onboarding_complete = true;
    return user;
  }

  async setRefreshTokenHash(id: string, hash: string | null): Promise<void> {
    const user = await this.findOne(id);
    user.refreshTokenHash = hash;
  }
}

class InMemoryCandidateProfileRepository {
  private readonly profiles = new Map<string, CandidateProfile>();
  private nextId = 1;

  create(payload: Partial<CandidateProfile>): CandidateProfile {
    return Object.assign(new CandidateProfile(), payload);
  }

  async save(profile: CandidateProfile): Promise<CandidateProfile> {
    const nextProfile = profile.id
      ? profile
      : Object.assign(profile, {
          id: `candidate-profile-${this.nextId++}`,
          created_at: new Date(),
          updated_at: new Date(),
        });
    this.profiles.set(nextProfile.user_id, nextProfile);
    return nextProfile;
  }

  findOne(options: {
    where: { user_id: string };
  }): Promise<CandidateProfile | null> {
    return Promise.resolve(this.profiles.get(options.where.user_id) ?? null);
  }
}

class InMemoryEmployerProfileRepository {
  private readonly profiles = new Map<string, EmployerProfile>();
  private nextId = 1;

  create(payload: Partial<EmployerProfile>): EmployerProfile {
    return Object.assign(new EmployerProfile(), payload);
  }

  async save(profile: EmployerProfile): Promise<EmployerProfile> {
    const nextProfile = profile.id
      ? profile
      : Object.assign(profile, {
          id: `employer-profile-${this.nextId++}`,
          created_at: new Date(),
          updated_at: new Date(),
        });
    this.profiles.set(nextProfile.user_id, nextProfile);
    return nextProfile;
  }

  findOne(options: {
    where: { user_id: string };
  }): Promise<EmployerProfile | null> {
    return Promise.resolve(this.profiles.get(options.where.user_id) ?? null);
  }
}

class StubVerificationOtpService {}

class StubMailService {}

const getSetCookies = (response: Response): string[] => {
  const header = response.headers['set-cookie'];
  if (Array.isArray(header)) {
    return header;
  }
  return typeof header === 'string' ? [header] : [];
};

const findCookie = (cookies: string[], name: string): string =>
  cookies.find((cookie) => cookie.startsWith(`${name}=`)) ?? '';

const accessCookieHeaderFor = async (
  jwtService: JwtService,
  user: User,
): Promise<string> => {
  const accessToken = await jwtService.signAsync(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      onboardingComplete: user.onboarding_complete,
    },
    {
      secret: env.JWT_ACCESS_SECRET,
      expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    },
  );

  return `${ACCESS_TOKEN_COOKIE}=${accessToken}`;
};

describe('Onboarding (e2e)', () => {
  let app: INestApplication<App>;
  let usersService: InMemoryUsersService;
  let jwtService: JwtService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({ secret: env.JWT_ACCESS_SECRET }),
      ],
      controllers: [CandidateController, EmployerController],
      providers: [
        CandidateService,
        EmployerService,
        AuthService,
        JwtStrategy,
        { provide: UsersService, useClass: InMemoryUsersService },
        {
          provide: getRepositoryToken(CandidateProfile),
          useClass: InMemoryCandidateProfileRepository,
        },
        {
          provide: getRepositoryToken(EmployerProfile),
          useClass: InMemoryEmployerProfileRepository,
        },
        { provide: VerificationOtpService, useClass: StubVerificationOtpService },
        { provide: MailService, useClass: StubMailService },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    await app.init();

    usersService = moduleFixture.get(UsersService);
    jwtService = moduleFixture.get(JwtService);
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /candidate/onboarding completes candidate onboarding and reissues auth cookies', async () => {
    const user = (await usersService.findOne('candidate-user')) as CandidateUser;
    const cookieHeader = await accessCookieHeaderFor(jwtService, user);

    const response = await request(app.getHttpServer())
      .post('/candidate/onboarding')
      .set('Cookie', cookieHeader)
      .send({
        roleTrack: 'frontend',
        bio: 'Entry-level frontend engineer focused on accessible web apps.',
      })
      .expect(200);

    const cookies = getSetCookies(response);
    expect(findCookie(cookies, ACCESS_TOKEN_COOKIE)).toContain('HttpOnly');
    expect(findCookie(cookies, REFRESH_TOKEN_COOKIE)).toContain('HttpOnly');
    expect(response.body).toMatchObject({
      status_code: 200,
      message: 'Candidate onboarding completed',
      user: {
        role: UserRole.CANDIDATE,
        onboardingComplete: true,
      },
      profile: {
        user_id: user.id,
        role_track: 'frontend',
        status: CandidateProfileStatus.NOT_STARTED,
      },
    });

    const updatedUser = await usersService.findOne(user.id);
    expect(updatedUser.onboarding_complete).toBe(true);
  });

  it('POST /candidate/onboarding rejects repeated completion', async () => {
    const user = (await usersService.findOne('candidate-user')) as CandidateUser;
    const cookieHeader = await accessCookieHeaderFor(jwtService, user);

    await request(app.getHttpServer())
      .post('/candidate/onboarding')
      .set('Cookie', cookieHeader)
      .send({ roleTrack: 'frontend' })
      .expect(200);

    const secondAccessCookie = await accessCookieHeaderFor(
      jwtService,
      (await usersService.findOne(user.id)) as CandidateUser,
    );

    await request(app.getHttpServer())
      .post('/candidate/onboarding')
      .set('Cookie', secondAccessCookie)
      .send({ roleTrack: 'frontend' })
      .expect(403)
      .expect((response) => {
        expect(response.body).toMatchObject({
          success: false,
          status_code: 403,
          message: 'Onboarding already completed',
        });
      });
  });

  it('POST /employer/onboarding completes employer onboarding', async () => {
    const user = (await usersService.findOne('employer-user')) as EmployerUser;
    const cookieHeader = await accessCookieHeaderFor(jwtService, user);

    const response = await request(app.getHttpServer())
      .post('/employer/onboarding')
      .set('Cookie', cookieHeader)
      .send({
        companyName: 'Acme Labs',
        companySize: '11-50',
        industry: 'Technology',
        websiteUrl: 'https://acmelabs.example',
        hiringRegion: 'Remote, Africa',
      })
      .expect(200);

    expect(response.body).toMatchObject({
      status_code: 200,
      message: 'Employer onboarding completed',
      user: {
        role: UserRole.EMPLOYER,
        onboardingComplete: true,
      },
      profile: {
        user_id: user.id,
        company_name: 'Acme Labs',
        company_size: '11-50',
        industry: 'Technology',
        website_url: 'https://acmelabs.example',
        hiring_region: 'Remote, Africa',
      },
    });
  });

  it('POST /employer/onboarding rejects the wrong role', async () => {
    const candidateUser = (await usersService.findOne(
      'candidate-user',
    )) as CandidateUser;
    const cookieHeader = await accessCookieHeaderFor(jwtService, candidateUser);

    await request(app.getHttpServer())
      .post('/employer/onboarding')
      .set('Cookie', cookieHeader)
      .send({ companyName: 'Acme Labs' })
      .expect(403)
      .expect((response) => {
        expect(response.body).toMatchObject({
          success: false,
          status_code: 403,
          message: 'Insufficient permissions',
        });
      });
  });
});
