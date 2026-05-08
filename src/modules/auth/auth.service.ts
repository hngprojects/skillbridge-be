import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import type { StringValue } from 'ms';
import { env } from '../../config/env';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { JwtPayload } from './strategies/jwt.strategy';

export interface Organisation {
  id: string;
  name: string;
  [key: string]: unknown;
}

export interface AuthUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  fullname: string;
  avatar_url: string | null;
  country: string;
  role: string;
  is_verified: boolean;
  onboardingComplete: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthSession {
  message: string;
  data: {
    user: AuthUser;
    organisations: Organisation[];
  };
}

export interface AuthResult {
  message: string;
  data: AuthSession['data'];
  tokens: AuthTokens;
}

export interface AuthResponse {
  message: string;
  status: 'success';
  data: AuthSession['data'];
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const user = await this.usersService.create({
      email: dto.email,
      password: dto.password,
      first_name: dto.firstName,
      last_name: dto.lastName,
      country: dto.country,
      profile_pic_url: dto.profile_pic_url,
    });
    return this.issueTokens(user, 'User created successfully');
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await argon2.verify(user.password, dto.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(user, 'Login successful');
  }

  async refresh(
    refreshToken: string | undefined,
  ): Promise<{ message: string; tokens: AuthTokens }> {
    if (!refreshToken) throw new UnauthorizedException('Invalid refresh token');

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: env.JWT_REFRESH_SECRET,
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const user = await this.usersService.findOneOrNull(payload.sub);
    if (!user?.refreshTokenHash) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    const matches = await argon2.verify(user.refreshTokenHash, refreshToken);
    if (!matches) throw new UnauthorizedException('Invalid refresh token');

    const tokens = await this.signTokens(user);
    const nextHash = await argon2.hash(tokens.refreshToken);
    const rotated = await this.usersService.rotateRefreshTokenHash(
      user.id,
      user.refreshTokenHash,
      nextHash,
    );
    if (!rotated) throw new UnauthorizedException('Invalid refresh token');

    return {
      message: 'Token refreshed successfully',
      tokens,
    };
  }

  async logout(userId: string): Promise<void> {
    await this.usersService.setRefreshTokenHash(userId, null);
  }

  async logoutByRefreshToken(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: env.JWT_REFRESH_SECRET,
      });
    } catch {
      return;
    }

    const user = await this.usersService.findOneOrNull(payload.sub);
    if (!user?.refreshTokenHash) return;

    const matches = await argon2.verify(user.refreshTokenHash, refreshToken);
    if (!matches) return;

    await this.usersService.setRefreshTokenHash(user.id, null);
  }

  async getProfile(userId: string): Promise<AuthUser> {
    const user = await this.usersService.findOne(userId);
    return this.toAuthUser(user);
  }

  toResponse(session: AuthSession): AuthResponse {
    return {
      message: session.message,
      status: 'success',
      data: session.data,
    };
  }

  private async issueTokens(user: User, message: string): Promise<AuthResult> {
    const tokens = await this.signTokens(user);
    await this.persistRefreshToken(user.id, tokens.refreshToken);

    return {
      message,
      data: {
        user: this.toAuthUser(user),
        organisations: [],
      },
      tokens,
    };
  }

  private async signTokens(user: User): Promise<AuthTokens> {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      onboardingComplete: user.onboarding_complete,
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        { ...payload, jti: randomUUID() },
        {
          secret: env.JWT_ACCESS_SECRET,
          expiresIn: env.JWT_ACCESS_EXPIRES_IN as StringValue,
        },
      ),
      this.jwtService.signAsync(
        { ...payload, jti: randomUUID() },
        {
          secret: env.JWT_REFRESH_SECRET,
          expiresIn: env.JWT_REFRESH_EXPIRES_IN as StringValue,
        },
      ),
    ]);
    return {
      accessToken,
      refreshToken,
    };
  }

  private async persistRefreshToken(
    userId: string,
    refreshToken: string,
  ): Promise<void> {
    const hash = await argon2.hash(refreshToken);
    await this.usersService.setRefreshTokenHash(userId, hash);
  }

  private toAuthUser(user: User): AuthUser {
    return {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      fullname: user.fullname,
      avatar_url: user.avatar_url,
      country: user.country,
      role: user.role,
      is_verified: user.is_verified,
      onboardingComplete: user.onboarding_complete,
    };
  }
}
