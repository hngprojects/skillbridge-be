import {
  ConflictException,
  INestApplication,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { PassportModule } from '@nestjs/passport';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App, Response } from 'supertest/types';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { env } from '../src/config/env';
import { AuthController } from '../src/modules/auth/auth.controller';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from '../src/modules/auth/auth.cookies';
import { AuthService, FORGOT_PASSWORD_SUCCESS_MESSAGE } from '../src/modules/auth/auth.service';
import { PasswordResetToken } from '../src/modules/auth/entities/password-reset-token.entity';
import { VerificationOtpSource } from '../src/modules/auth/entities/verification-otp.entity';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
import {
  IssuedVerificationOtp,
  VerificationOtpService,
} from '../src/modules/auth/verification-otp.service';
import { MailService } from '../src/modules/mail/mail.service';
import { CreateUserDto } from '../src/modules/users/dto/create-user.dto';
import { User, UserRole } from '../src/modules/users/entities/user.entity';
import { UsersService } from '../src/modules/users/users.service';

type RegisterPayload = {
  firstName: string;
  lastName: string;
  email: string;
  country: string;
  password: string;
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
      role: UserRole.CANDIDATE,
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

  readonly passwordResetMessages: Array<{
    to: string;
    token: string;
    expiresAt: Date;
    resetLink?: string;
  }> = [];

  async sendVerificationOtp(params: {
    to: string;
    otp: string;
    expiresAt: Date;
  }) {
    this.verificationMessages.push(params);
    return { id: `mail-${this.verificationMessages.length}` };
  }

  async sendPasswordReset(params: {
    to: string;
    token: string;
    expiresAt: Date;
    resetLink?: string;
  }) {
    this.passwordResetMessages.push(params);
    return { id: `reset-mail-${this.passwordResetMessages.length}` };
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

const mockPasswordResetSave = jest.fn().mockResolvedValue(undefined);
const mockPasswordResetInvalidateExecute = jest.fn().mockResolvedValue({
  affected: 0,
});

const mockPasswordResetTokenRepository = {
  create: jest.fn((row: unknown) => row),
  save: mockPasswordResetSave,
  findOne: jest.fn().mockResolvedValue(null),
  createQueryBuilder: jest.fn(() => ({
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    execute: mockPasswordResetInvalidateExecute,
  })),
  manager: {
    transaction: jest.fn(async (fn: (m: {
      createQueryBuilder: () => {
        update: jest.Mock;
        set: jest.Mock;
        where: jest.Mock;
        andWhere: jest.Mock;
        execute: jest.Mock;
      };
      findOne: jest.Mock;
      create: jest.Mock;
      save: jest.Mock;
    }) => Promise<void>) => {
        const qb = {
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          execute: mockPasswordResetInvalidateExecute,
        };
        await fn({
          createQueryBuilder: () => qb,
          findOne: jest.fn(async (Entity: unknown, opts?: { where?: { id?: string } }) => {
            if (Entity === User && opts?.where?.id) {
              return { id: opts.where.id };
            }
            return null;
          }),
          create: jest.fn((_entity: unknown, row: unknown) => row),
          save: mockPasswordResetSave,
        });
      },
    ),
  },
};

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let usersService: InMemoryUsersService;
  let verificationOtpService: InMemoryVerificationOtpService;
  let mailService: MockMailService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
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
        {
          provide: getRepositoryToken(PasswordResetToken),
          useValue: mockPasswordResetTokenRepository,
        },
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
    jest.clearAllMocks();
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
    expect(mailService.verificationMessages).toHaveLength(1);
    expect(mailService.verificationMessages[0]?.to).toBe(registerPayload.email);
  });

  it('POST /auth/forgot-password returns same 200 payload for unknown email and does not send mail', async () => {
    const body = { email: 'missing@example.com' };

    const response = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send(body)
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'success',
      message: FORGOT_PASSWORD_SUCCESS_MESSAGE,
    });
    expect(mailService.passwordResetMessages).toHaveLength(0);
    expect(mockPasswordResetTokenRepository.save).not.toHaveBeenCalled();
    expect(mockPasswordResetInvalidateExecute).not.toHaveBeenCalled();
  });

  it('POST /auth/forgot-password for existing user triggers token save and sends reset mail', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerPayload)
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send({ email: registerPayload.email })
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'success',
      message: FORGOT_PASSWORD_SUCCESS_MESSAGE,
    });
    expect(mockPasswordResetInvalidateExecute).toHaveBeenCalled();
    expect(mockPasswordResetTokenRepository.save).toHaveBeenCalled();
    expect(mailService.passwordResetMessages).toHaveLength(1);
    expect(mailService.passwordResetMessages[0]?.to).toBe(registerPayload.email);
    expect(mailService.passwordResetMessages[0]?.token?.length).toBeGreaterThan(
      10,
    );
  });

  it('POST /auth/forgot-password sets reset link with fragment token when PASSWORD_RESET_WEB_BASE_URL is set', async () => {
    jest.replaceProperty(
      env,
      'PASSWORD_RESET_WEB_BASE_URL',
      'https://example.com/reset',
    );
    try {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send(registerPayload)
        .expect(201);

      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send({ email: registerPayload.email })
        .expect(200);

      const link = mailService.passwordResetMessages[0]?.resetLink;
      expect(link).toBeDefined();
      expect(link).toMatch(/^https:\/\/example\.com\/reset#token=/);
    } finally {
      jest.replaceProperty(env, 'PASSWORD_RESET_WEB_BASE_URL', undefined);
    }
  });

  it('POST /auth/forgot-password returns 429 after 5 requests in the same minute from the same client', async () => {
    const body = { email: 'nobody-for-rate-limit@example.com' };
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/auth/forgot-password')
        .send(body)
        .expect(200);
    }
    const sixth = await request(app.getHttpServer())
      .post('/auth/forgot-password')
      .send(body)
      .expect(429);

    expect(sixth.body).toMatchObject({
      success: false,
      status_code: 429,
    });
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
        role: UserRole.CANDIDATE,
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
