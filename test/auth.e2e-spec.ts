import {
  ConflictException,
  ExecutionContext,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { Response } from 'supertest';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { env } from '../src/config/env';
import { AuthController } from '../src/modules/auth/auth.controller';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '../src/modules/auth/auth.cookies';
import { AuthService } from '../src/modules/auth/auth.service';
import { GoogleOAuthGuard } from '../src/modules/auth/guards/google-auth.guard';
import type { GoogleProfile } from '../src/modules/auth/strategies/google.strategy';
import { OAuthUser } from '../src/modules/users/entities/user-oauth.entity';
import { VerificationOtpSource } from '../src/modules/auth/entities/verification-otp.entity';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import {
  IssuedVerificationOtp,
  VerificationOtpService,
} from '../src/modules/auth/verification-otp.service';
import { MailService } from '../src/modules/mail/mail.service';
import { CreateUserDto } from '../src/modules/users/dto/create-user.dto';
import { UpdateUserDto } from '../src/modules/users/dto/update-user.dto';
import { User, UserRole } from '../src/modules/users/entities/user.entity';
import { UsersService } from '../src/modules/users/users.service';

type RegisterPayload = {
  firstName: string;
  lastName: string;
  email: string;
  country: string;
  password: string;
  role: UserRole.CANDIDATE | UserRole.EMPLOYER;
};

type LoginPayload = {
  email: string;
  password: string;
};

type StoredOtp = {
  userId: string;
  code: string;
  expiresAt: Date;
  usedAt: Date | null;
  requestSource: VerificationOtpSource;
  createdAt: Date;
};

const registerPayload: RegisterPayload = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  country: 'Nigeria',
  password: 'StrongPass123',
  role: UserRole.CANDIDATE,
};

const loginPayload: LoginPayload = {
  email: registerPayload.email,
  password: registerPayload.password,
};

class InMemoryUsersService {
  private readonly usersById = new Map<string, User>();
  private readonly usersByEmail = new Map<string, User>();
  private nextId = 1;

  async create(dto: CreateUserDto): Promise<User> {
    if (this.usersByEmail.has(dto.email)) {
      throw new ConflictException('Email already registered');
    }

    const user = Object.assign(new User(), {
      id: `user-${this.nextId++}`,
      email: dto.email,
      password: await argon2.hash(dto.password),
      first_name: dto.first_name,
      last_name: dto.last_name,
      country: dto.country,
      avatar_url: dto.profile_pic_url ?? null,
      is_verified: false,
      onboarding_complete: false,
      role: dto.role ?? UserRole.CANDIDATE,
      refreshTokenHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    this.usersById.set(user.id, user);
    this.usersByEmail.set(user.email, user);
    return user;
  }

  findByEmail(email: string): Promise<User | null> {
    return Promise.resolve(this.usersByEmail.get(email) ?? null);
  }

  findOneOrNull(id: string): Promise<User | null> {
    return Promise.resolve(this.usersById.get(id) ?? null);
  }

  async findOne(id: string): Promise<User> {
    const user = this.usersById.get(id);
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  async setRefreshTokenHash(id: string, hash: string | null): Promise<void> {
    const user = this.usersById.get(id);
    if (user) user.refreshTokenHash = hash;
  }

  async markVerified(id: string): Promise<User> {
    const user = await this.findOne(id);
    user.is_verified = true;
    return user;
  }

  rotateRefreshTokenHash(
    id: string,
    currentHash: string,
    nextHash: string,
  ): Promise<boolean> {
    const user = this.usersById.get(id);
    if (!user || user.refreshTokenHash !== currentHash) {
      return Promise.resolve(false);
    }

    user.refreshTokenHash = nextHash;
    return Promise.resolve(true);
  }

  async update(id: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findOne(id);
    const { profile_pic_url: profilePicUrl, ...rest } = dto as UpdateUserDto & {
      profile_pic_url?: string;
    };
    Object.assign(user, rest);
    if (profilePicUrl !== undefined) user.avatar_url = profilePicUrl;
    return user;
  }

  // ── OAuth helpers ──────────────────────────────────────────────────────
  // A simple list of { provider, provider_id, user } records
  private readonly oauthAccounts: Array<{
    provider: string;
    provider_id: string;
    user: User;
  }> = [];

  findOAuthAccount(
    provider: string,
    provider_id: string,
  ): Promise<OAuthUser | null> {
    const found = this.oauthAccounts.find(
      (a) => a.provider === provider && a.provider_id === provider_id,
    );
    // Return a minimal OAuthUser shape with the linked user attached
    return Promise.resolve(
      found ? Object.assign(new OAuthUser(), found) : null,
    );
  }

  async findOauthAccountWithUser(
    provider: string,
    providerId: string,
  ): Promise<{ oauth: OAuthUser; user: User } | null> {
    const found = this.oauthAccounts.find(
      (a) => a.provider === provider && a.provider_id === providerId,
    );
    if (!found) return null;
    const oauth = Object.assign(new OAuthUser(), found);
    return { oauth, user: found.user };
  }

  createOAuthAccount(
    userId: string,
    provider: string,
    provider_id: string,
  ): Promise<void> {
    const user = this.usersById.get(userId)!;
    this.oauthAccounts.push({ provider, provider_id, user });
    return Promise.resolve();
  }

  async linkOauthAccountToUser(
    userId: string,
    provider: string,
    providerId: string,
  ): Promise<void> {
    const user = this.usersById.get(userId);
    if (!user) throw new NotFoundException(`User ${userId} not found`);
    this.oauthAccounts.push({ provider, provider_id: providerId, user });
  }

  async createVerifiedUserWithOauthLink(params: {
    email: string;
    first_name: string;
    last_name: string;
    country: string;
    avatar_url: string | null;
    provider: string;
    providerId: string;
  }): Promise<User> {
    const result = await this.createOAuthUser(
      params.provider,
      params.providerId,
      params.first_name,
      params.last_name,
      params.email,
      'Unknown',
      params.avatar_url,
    );
    return result.user;
  }

  async createOAuthUser(
    provider: string,
    provider_id: string,
    first_name: string,
    last_name: string,
    email: string,
    country: 'Unknown',
    avatar_url?: string | null,
  ): Promise<{ user: User; oauthUser: OAuthUser }> {
    const user = Object.assign(new User(), {
      id: `user-${this.nextId++}`,
      email,
      password: null,
      first_name,
      last_name,
      country,
      avatar_url: avatar_url ?? null,
      is_verified: true,
      onboarding_complete: false,
      role: UserRole.CANDIDATE,
      refreshTokenHash: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    this.usersById.set(user.id, user);
    this.usersByEmail.set(user.email, user);
    this.oauthAccounts.push({ provider, provider_id, user });

    const oauthUser = Object.assign(new OAuthUser(), {
      provider,
      provider_id,
      user,
    });
    return { user, oauthUser };
  }

  async findOrCreateAndLinkOAuthUser(
    provider: string,
    provider_id: string,
    first_name: string,
    last_name: string,
    email: string,
    country: string,
    avatar_url?: string | null,
  ): Promise<{ user: User; oauthUser: OAuthUser }> {
    // In test environment, we can simply delegate to createOAuthUser
    // since we don't need to handle concurrent requests
    return this.createOAuthUser(
      provider,
      provider_id,
      first_name,
      last_name,
      email,
      country as 'Unknown',
      avatar_url,
    );
  }

  async resolveOAuthUserFromProviderProfile(
    provider: string,
    profile: {
      providerId: string;
      email: string;
      firstName: string;
      lastName: string;
      avatarUrl: string | null;
    },
  ): Promise<User> {
    // Check if OAuth account already exists
    const linked = await this.findOauthAccountWithUser(provider, profile.providerId);
    if (linked) {
      return linked.user;
    }

    // Check if user with email exists
    const byEmail = await this.findByEmail(profile.email);
    if (byEmail) {
      // Mark as verified and link OAuth account
      if (!byEmail.is_verified) {
        await this.markVerified(byEmail.id);
      }
      await this.linkOauthAccountToUser(byEmail.id, provider, profile.providerId);
      return this.findOne(byEmail.id);
    }

    // Create new user with OAuth link
    return await this.createVerifiedUserWithOauthLink({
      email: profile.email,
      first_name: profile.firstName,
      last_name: profile.lastName,
      country: 'Unknown',
      avatar_url: profile.avatarUrl,
      provider,
      providerId: profile.providerId,
    });
  }
}

class InMemoryVerificationOtpService {
  private readonly otps: StoredOtp[] = [];
  private nextCode = 1;

  async issue(
    userId: string,
    requestSource: VerificationOtpSource,
  ): Promise<IssuedVerificationOtp> {
    const now = new Date();
    this.otps.forEach((otp) => {
      if (otp.userId === userId && otp.usedAt === null && otp.expiresAt > now) {
        otp.usedAt = now;
      }
    });

    const code = String(this.nextCode++).padStart(6, '0');
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
    this.otps.push({
      userId,
      code,
      expiresAt,
      usedAt: null,
      requestSource,
      createdAt: now,
    });

    return { code, expiresAt };
  }

  async consume(userId: string, code: string): Promise<boolean> {
    const latestOtp = [...this.otps]
      .filter(
        (otp) =>
          otp.userId === userId &&
          otp.usedAt === null &&
          otp.expiresAt.getTime() > Date.now(),
      )
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      )[0];

    if (!latestOtp || latestOtp.code !== code) {
      return false;
    }

    latestOtp.usedAt = new Date();
    return true;
  }

  countRecentResends(userId: string, since: Date): Promise<number> {
    const count = this.otps.filter(
      (otp) =>
        otp.userId === userId &&
        otp.requestSource === VerificationOtpSource.RESEND &&
        otp.createdAt.getTime() >= since.getTime(),
    ).length;

    return Promise.resolve(count);
  }

  peekLatestCode(userId: string): string | undefined {
    return [...this.otps]
      .filter((otp) => otp.userId === userId)
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      )[0]?.code;
  }

  expireLatest(userId: string): void {
    const latestOtp = [...this.otps]
      .filter((otp) => otp.userId === userId)
      .sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      )[0];

    if (latestOtp) {
      latestOtp.expiresAt = new Date(Date.now() - 1_000);
    }
  }
}

class MockMailService {
  readonly verificationMessages: Array<{
    to: string;
    otp: string;
    expiresAt: Date;
  }> = [];

  async sendVerificationOtp(params: {
    to: string;
    otp: string;
    expiresAt: Date;
  }) {
    this.verificationMessages.push(params);
    return { id: `mail-${this.verificationMessages.length}` };
  }
}

const getSetCookies = (response: Response): string[] => {
  const header = response.headers['set-cookie'];
  if (Array.isArray(header)) return header;
  return typeof header === 'string' ? [header] : [];
};

const findCookie = (cookies: string[], name: string): string =>
  cookies.find((cookie) => cookie.startsWith(`${name}=`)) ?? '';

const cookiePair = (cookie: string): string => cookie.split(';')[0];

const expectAuthCookies = (response: Response): string => {
  const cookies = getSetCookies(response);
  const accessCookie = findCookie(cookies, ACCESS_TOKEN_COOKIE);
  const refreshCookie = findCookie(cookies, REFRESH_TOKEN_COOKIE);

  expect(accessCookie).toContain('HttpOnly');
  expect(accessCookie).toContain('SameSite=Strict');
  expect(refreshCookie).toContain('HttpOnly');
  expect(refreshCookie).toContain('SameSite=Strict');

  return cookies.map(cookiePair).join('; ');
};

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let usersService: InMemoryUsersService;
  let verificationOtpService: InMemoryVerificationOtpService;
  let mailService: MockMailService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({ secret: env.JWT_ACCESS_SECRET }),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        JwtStrategy,
        { provide: UsersService, useClass: InMemoryUsersService },
        {
          provide: VerificationOtpService,
          useClass: InMemoryVerificationOtpService,
        },
        { provide: MailService, useClass: MockMailService },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
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
    verificationOtpService = moduleFixture.get(VerificationOtpService);
    mailService = moduleFixture.get(MailService);
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('POST /auth/register creates an unverified user and sends an OTP without cookies', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerPayload)
      .expect(201);

    expect(getSetCookies(response)).toHaveLength(0);
    expect(response.body).toMatchObject({
      status_code: 201,
      message: 'Verification otp sent',
    });

    const createdUser = await usersService.findByEmail(registerPayload.email);
    expect(createdUser?.is_verified).toBe(false);
    expect(createdUser?.role).toBe(registerPayload.role);
    expect(mailService.verificationMessages).toHaveLength(1);
    expect(mailService.verificationMessages[0]?.to).toBe(registerPayload.email);
  });

  it('POST /auth/register persists the selected employer role', async () => {
    const employerPayload: RegisterPayload = {
      ...registerPayload,
      email: 'employer@example.com',
      role: UserRole.EMPLOYER,
    };

    await request(app.getHttpServer())
      .post('/auth/register')
      .send(employerPayload)
      .expect(201);

    const createdUser = await usersService.findByEmail(employerPayload.email);
    expect(createdUser?.role).toBe(UserRole.EMPLOYER);
  });

  it('POST /auth/register rejects duplicate emails', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerPayload)
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerPayload)
      .expect(409)
      .expect((response) => {
        expect(response.body).toMatchObject({
          success: false,
          status_code: 409,
          message: 'Email already registered',
        });
      });
  });

  it('POST /auth/login blocks unverified users', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerPayload)
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send(loginPayload)
      .expect(403);

    expect(getSetCookies(response)).toHaveLength(0);
    expect(response.body).toMatchObject({
      success: false,
      status_code: 403,
      error: 'EMAIL_NOT_VERIFIED',
      message: 'Please verify your email to continue',
      email: registerPayload.email,
    });
  });

  it('POST /auth/verify-email verifies the user and issues auth cookies', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerPayload)
      .expect(201);

    const user = await usersService.findByEmail(registerPayload.email);
    const otp = verificationOtpService.peekLatestCode(user!.id);

    const response = await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ email: registerPayload.email, otp })
      .expect(200);

    const authCookieHeader = expectAuthCookies(response);
    expect(response.body).toMatchObject({
      status_code: 200,
      message: 'Email verified',
      user: {
        email: registerPayload.email,
        first_name: registerPayload.firstName,
        last_name: registerPayload.lastName,
        fullname: `${registerPayload.firstName} ${registerPayload.lastName}`,
        country: registerPayload.country,
        role: registerPayload.role,
        is_verified: true,
        onboardingComplete: false,
      },
    });

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', authCookieHeader)
      .expect(200)
      .expect((meResponse) => {
        expect(meResponse.body).toMatchObject({
          status_code: 200,
          message: 'success',
          data: {
            email: registerPayload.email,
            is_verified: true,
          },
        });
      });
  });

  it('POST /auth/verify-email rejects invalid, expired, and reused OTPs', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerPayload)
      .expect(201);

    const user = await usersService.findByEmail(registerPayload.email);
    const otp = verificationOtpService.peekLatestCode(user!.id);

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ email: registerPayload.email, otp: '999999' })
      .expect(400);

    verificationOtpService.expireLatest(user!.id);
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ email: registerPayload.email, otp })
      .expect(400);

    await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: registerPayload.email })
      .expect(200);

    const freshOtp = verificationOtpService.peekLatestCode(user!.id);
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ email: registerPayload.email, otp: freshOtp })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ email: registerPayload.email, otp: freshOtp })
      .expect(400);
  });

  it('POST /auth/resend-verification invalidates the previous OTP and enforces the hourly limit', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerPayload)
      .expect(201);

    const user = await usersService.findByEmail(registerPayload.email);
    const initialOtp = verificationOtpService.peekLatestCode(user!.id);

    await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: registerPayload.email })
      .expect(200);

    const resentOtp = verificationOtpService.peekLatestCode(user!.id);
    expect(resentOtp).not.toBe(initialOtp);

    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ email: registerPayload.email, otp: initialOtp })
      .expect(400);

    await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: registerPayload.email })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: registerPayload.email })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: registerPayload.email })
      .expect(429)
      .expect((response) => {
        expect(response.body).toMatchObject({
          success: false,
          status_code: 429,
          message: 'Too many requests. Please wait before trying again.',
        });
      });
  });

  it('POST /auth/resend-verification rejects already verified accounts', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerPayload)
      .expect(201);

    const user = await usersService.findByEmail(registerPayload.email);
    const otp = verificationOtpService.peekLatestCode(user!.id);
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ email: registerPayload.email, otp })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/resend-verification')
      .send({ email: registerPayload.email })
      .expect(400)
      .expect((response) => {
        expect(response.body).toMatchObject({
          success: false,
          status_code: 400,
          message: 'Account is already verified',
        });
      });
  });

  it('verified users can log in, refresh, and log out', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerPayload)
      .expect(201);

    const user = await usersService.findByEmail(registerPayload.email);
    const otp = verificationOtpService.peekLatestCode(user!.id);
    await request(app.getHttpServer())
      .post('/auth/verify-email')
      .send({ email: registerPayload.email, otp })
      .expect(200);

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send(loginPayload)
      .expect(200);
    const loginCookieHeader = expectAuthCookies(loginResponse);

    const refreshResponse = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', loginCookieHeader)
      .expect(200);
    const refreshCookieHeader = expectAuthCookies(refreshResponse);

    expect(refreshResponse.body).toMatchObject({
      status_code: 200,
      message: 'Token refreshed successfully',
      status: 'success',
    });

    const logoutResponse = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', refreshCookieHeader)
      .expect(200);

    const cookies = getSetCookies(logoutResponse);
    expect(findCookie(cookies, ACCESS_TOKEN_COOKIE)).toContain(
      `${ACCESS_TOKEN_COOKIE}=;`,
    );
    expect(findCookie(cookies, REFRESH_TOKEN_COOKIE)).toContain(
      `${REFRESH_TOKEN_COOKIE}=;`,
    );

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', refreshCookieHeader)
      .expect(401);
  });
});

// github-callback endpoint test
const googleProfile: GoogleProfile = {
  email: 'google-user@example.com',
  firstName: 'Google',
  lastName: 'User',
  picture: 'https://example.com/photo.jpg',
  providerId: 'google-provider-123',
  country: 'Unknown',
};

class FakeGoogleOAuthGuard {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.user = googleProfile;
    return true;
  }
}

describe('Google OAuth callback (e2e)', () => {
  let app: INestApplication<App>;
  let usersService: InMemoryUsersService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({ secret: env.JWT_ACCESS_SECRET }),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        JwtStrategy,
        { provide: UsersService, useClass: InMemoryUsersService },
        {
          provide: VerificationOtpService,
          useClass: InMemoryVerificationOtpService,
        },
        { provide: MailService, useClass: MockMailService },
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
        { provide: GoogleOAuthGuard, useClass: FakeGoogleOAuthGuard },
      ],
    })
      .overrideGuard(GoogleOAuthGuard)
      .useClass(FakeGoogleOAuthGuard)
      .compile();

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
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('GET /auth/google/callback logs in a returning Google user (already linked)', async () => {
    await usersService.createOAuthUser(
      'google',
      googleProfile.providerId,
      googleProfile.firstName,
      googleProfile.lastName,
      googleProfile.email,
      'Unknown',
      googleProfile.picture,
    );

    const response = await request(app.getHttpServer())
      .get('/auth/google/callback')
      .expect(302);

    expect(response.headers['location']).toContain('/onboarding');
    const cookies = getSetCookies(response);
    expect(cookies.some((c) => c.startsWith(ACCESS_TOKEN_COOKIE))).toBe(true);
    expect(cookies.some((c) => c.startsWith(REFRESH_TOKEN_COOKIE))).toBe(true);
  });

  it('GET /auth/google/callback links Google to an existing email account', async () => {
    await usersService.create({
      email: googleProfile.email,
      password: 'SomeHash',
      first_name: googleProfile.firstName,
      last_name: googleProfile.lastName,
      country: 'Nigeria',
      profile_pic_url: undefined,
    });

    const response = await request(app.getHttpServer())
      .get('/auth/google/callback')
      .expect(302);

    expect(response.headers['location']).toContain('/onboarding');
    const cookies = getSetCookies(response);
    expect(cookies.some((c) => c.startsWith(ACCESS_TOKEN_COOKIE))).toBe(true);

    const linked = await usersService.findOAuthAccount(
      'google',
      googleProfile.providerId,
    );
    expect(linked).not.toBeNull();
  });

  it('GET /auth/google/callback creates a brand-new user on first login', async () => {
    const response = await request(app.getHttpServer())
      .get('/auth/google/callback')
      .expect(302);

    expect(response.headers['location']).toContain('/onboarding');
    const cookies = getSetCookies(response);
    expect(cookies.some((c) => c.startsWith(ACCESS_TOKEN_COOKIE))).toBe(true);

    const newUser = await usersService.findByEmail(googleProfile.email);
    expect(newUser).not.toBeNull();
    expect(newUser?.is_verified).toBe(true);
    expect(newUser?.first_name).toBe(googleProfile.firstName);
  });
});
