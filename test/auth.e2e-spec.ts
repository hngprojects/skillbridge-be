import {
  ConflictException,
  INestApplication,
  ValidationPipe,
  NotFoundException,
} from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
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
import { AuthService } from '../src/modules/auth/auth.service';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import { JwtStrategy } from '../src/modules/auth/strategies/jwt.strategy';
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
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it('POST /auth/register creates a candidate session with httpOnly cookies', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerPayload)
      .expect(201);

    expectAuthCookies(response);
    expect(response.body).toMatchObject({
      status_code: 201,
      message: 'User created successfully',
      status: 'success',
      data: {
        user: {
          email: registerPayload.email,
          first_name: registerPayload.firstName,
          last_name: registerPayload.lastName,
          fullname: `${registerPayload.firstName} ${registerPayload.lastName}`,
          country: registerPayload.country,
          avatar_url: null,
          role: UserRole.CANDIDATE,
          is_verified: false,
          onboardingComplete: false,
        },
        organisations: [],
      },
    });
    expect(response.body.access_token).toBeUndefined();
    expect(response.body.refresh_token).toBeUndefined();
  });

  it('POST /auth/login creates auth cookies without returning tokens in JSON', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerPayload)
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send(loginPayload)
      .expect(200);

    expectAuthCookies(response);
    expect(response.body).toMatchObject({
      status_code: 200,
      message: 'Login successful',
      status: 'success',
      data: {
        user: {
          email: registerPayload.email,
          role: UserRole.CANDIDATE,
          onboardingComplete: false,
        },
        organisations: [],
      },
    });
    expect(response.body.access_token).toBeUndefined();
    expect(response.body.refresh_token).toBeUndefined();
  });

  it('POST /auth/logout revokes the session and clears auth cookies', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerPayload)
      .expect(201);

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send(loginPayload)
      .expect(200);
    const loginCookies = getSetCookies(loginResponse);
    const refreshCookieHeader = cookiePair(
      findCookie(loginCookies, REFRESH_TOKEN_COOKIE),
    );

    const response = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', refreshCookieHeader)
      .expect(200);

    const cookies = getSetCookies(response);
    expect(findCookie(cookies, ACCESS_TOKEN_COOKIE)).toContain(
      `${ACCESS_TOKEN_COOKIE}=;`,
    );
    expect(findCookie(cookies, REFRESH_TOKEN_COOKIE)).toContain(
      `${REFRESH_TOKEN_COOKIE}=;`,
    );
    expect(response.body).toMatchObject({
      status_code: 200,
      message: 'Logged out',
      status: 'success',
    });

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', refreshCookieHeader)
      .expect(401);
  });

  it('POST /auth/refresh rotates refresh cookies and rejects the previous refresh token', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerPayload)
      .expect(201);

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send(loginPayload)
      .expect(200);
    const loginCookies = getSetCookies(loginResponse);
    const loginCookieHeader = loginCookies.map(cookiePair).join('; ');

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
    expect(refreshResponse.body.access_token).toBeUndefined();
    expect(refreshResponse.body.refresh_token).toBeUndefined();
    expect(
      findCookie(getSetCookies(refreshResponse), REFRESH_TOKEN_COOKIE),
    ).not.toBe(findCookie(loginCookies, REFRESH_TOKEN_COOKIE));

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', loginCookieHeader)
      .expect(401)
      .expect((response) => {
        expect(response.body).toMatchObject({
          success: false,
          status_code: 401,
          message: 'Invalid refresh token',
        });
      });

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', refreshCookieHeader)
      .expect(200);
  });

  it('POST /auth/refresh treats malformed cookie values as missing', async () => {
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `${REFRESH_TOKEN_COOKIE}=%E0%A4%A`)
      .expect(401)
      .expect((response) => {
        expect(response.body).toMatchObject({
          success: false,
          status_code: 401,
          message: 'Invalid refresh token',
        });
      });
  });

  it('GET /auth/me reads the access token from the httpOnly cookie', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerPayload)
      .expect(201);

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send(loginPayload)
      .expect(200);
    const authCookieHeader = expectAuthCookies(loginResponse);

    const response = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', authCookieHeader)
      .expect(200);

    expect(response.body).toMatchObject({
      status_code: 200,
      message: 'success',
      data: {
        email: registerPayload.email,
        first_name: registerPayload.firstName,
        last_name: registerPayload.lastName,
        fullname: `${registerPayload.firstName} ${registerPayload.lastName}`,
        country: registerPayload.country,
        role: UserRole.CANDIDATE,
        is_verified: false,
        onboardingComplete: false,
      },
    });
  });
});
