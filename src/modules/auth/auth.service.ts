import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import type { StringValue } from 'ms';
import { Repository } from 'typeorm';
import { env } from '../../config/env';
import { parseDurationToMs } from '../../config/duration';
import { MailService } from '../mail/mail.service';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { VerificationOtpSource } from './entities/verification-otp.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { JwtPayload } from './strategies/jwt.strategy';
import { VerificationOtpService } from './verification-otp.service';

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

export interface VerifyEmailResult {
  message: string;
  user: AuthUser;
  tokens: AuthTokens;
}

export const FORGOT_PASSWORD_SUCCESS_MESSAGE =
  'If that email exists, a reset link has been sent';

export interface ForgotPasswordResponse {
  status: 'success';
  message: string;
}

interface IssuedPasswordResetToken {
  token: string;
  expiresAt: Date;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly verificationOtpService: VerificationOtpService,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetTokenRepository: Repository<PasswordResetToken>,
    private readonly mailService: MailService,
  ) {}

  async register(dto: RegisterDto): Promise<{ message: string }> {
    const user = await this.usersService.create({
      email: dto.email,
      password: dto.password,
      first_name: dto.firstName,
      last_name: dto.lastName,
      country: dto.country,
      profile_pic_url: dto.profile_pic_url,
    });

    const issuedOtp = await this.verificationOtpService.issue(
      user.id,
      VerificationOtpSource.INITIAL,
    );
    await this.mailService.sendVerificationOtp({
      to: user.email,
      otp: issuedOtp.code,
      expiresAt: issuedOtp.expiresAt,
    });

    return {
      message: 'Verification otp sent',
    };
  }

  async verifyEmail(dto: VerifyEmailDto): Promise<VerifyEmailResult> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new BadRequestException('Invalid or expired otp');
    }

    const isValidOtp = await this.verificationOtpService.consume(
      user.id,
      dto.otp,
    );
    if (!isValidOtp) {
      throw new BadRequestException('Invalid or expired otp');
    }

    const verifiedUser = user.is_verified
      ? user
      : await this.usersService.markVerified(user.id);
    const tokens = await this.signTokens(verifiedUser);
    await this.persistRefreshToken(verifiedUser.id, tokens.refreshToken);

    return {
      message: 'Email verified',
      user: this.toAuthUser(verifiedUser),
      tokens,
    };
  }

  async resendVerification(
    dto: ResendVerificationDto,
  ): Promise<{ message: string }> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new BadRequestException('Account not found');
    }
    if (user.is_verified) {
      throw new BadRequestException('Account is already verified');
    }

    const resendCount = await this.verificationOtpService.countRecentResends(
      user.id,
      new Date(Date.now() - 60 * 60 * 1000),
    );
    if (resendCount >= env.VERIFICATION_RESEND_LIMIT_PER_HOUR) {
      throw new HttpException(
        'Too many requests. Please wait before trying again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const issuedOtp = await this.verificationOtpService.issue(
      user.id,
      VerificationOtpSource.RESEND,
    );
    await this.mailService.sendVerificationOtp({
      to: user.email,
      otp: issuedOtp.code,
      expiresAt: issuedOtp.expiresAt,
    });

    return {
      message: 'Verification email resent',
    };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    if (!user.is_verified) {
      throw new ForbiddenException({
        error: 'EMAIL_NOT_VERIFIED',
        message: 'Please verify your email to continue',
        email: user.email,
      });
    }

    const valid = await argon2.verify(user.password, dto.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(user, 'Login successful');
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
  ): Promise<ForgotPasswordResponse> {
    const email = dto.email.trim();
    const user = await this.usersService.findByEmail(email);

    if (user) {
      try {
        const issued = await this.issuePasswordResetToken(user.id);
        const resetLink = this.buildPasswordResetLink(issued.token);
        await this.mailService.sendPasswordReset({
          to: user.email,
          token: issued.token,
          expiresAt: issued.expiresAt,
          ...(resetLink ? { resetLink } : {}),
        });
      } catch (err) {
        this.logger.error(
          `Forgot-password side effects failed for ${user.email}`,
          err instanceof Error ? err.stack : err,
        );
      }
    }

    return {
      status: 'success',
      message: FORGOT_PASSWORD_SUCCESS_MESSAGE,
    };
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

  private buildPasswordResetLink(token: string): string | undefined {
    const base = env.PASSWORD_RESET_WEB_BASE_URL;
    if (!base?.trim()) {
      return undefined;
    }
    const trimmed = base.replace(/\/$/, '');
    const sep = trimmed.includes('?') ? '&' : '?';
    return `${trimmed}${sep}token=${encodeURIComponent(token)}`;
  }

  private async issuePasswordResetToken(
    userId: string,
  ): Promise<IssuedPasswordResetToken> {
    const token = randomBytes(32).toString('base64url');
    const tokenLookupHash = this.passwordResetLookupHash(token);
    const expiresAt = new Date(
      Date.now() + parseDurationToMs(env.PASSWORD_RESET_EXPIRES_IN),
    );
    const tokenHash = await argon2.hash(token);

    await this.passwordResetTokenRepository.manager.transaction(
      async (manager) => {
        await manager
          .createQueryBuilder()
          .update(PasswordResetToken)
          .set({ usedAt: () => 'CURRENT_TIMESTAMP' })
          .where('user_id = :userId', { userId })
          .andWhere('used_at IS NULL')
          .andWhere('expires_at > NOW()')
          .execute();

        const row = manager.create(PasswordResetToken, {
          userId,
          tokenLookupHash,
          tokenHash,
          expiresAt,
          usedAt: null,
        });
        await manager.save(row);
      },
    );

    return { token, expiresAt };
  }

  private passwordResetLookupHash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
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
