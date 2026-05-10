import {
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { randomUUID, timingSafeEqual } from 'crypto';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import type { StringValue } from 'ms';
import { env, linkedInHttpMaxBodyBytes, linkedInHttpTimeoutMs } from '../../config/env';
import { MailService } from '../mail/mail.service';
import { User, UserRole } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import {
  clearLinkedInOAuthStateCookie,
  LINKEDIN_OAUTH_STATE_COOKIE,
  readCookie,
  setAuthCookies,
  setLinkedInOAuthStateCookie,
} from './auth.cookies';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { VerificationOtpSource } from './entities/verification-otp.entity';
import { JwtPayload } from './strategies/jwt.strategy';
import { VerificationOtpService } from './verification-otp.service';
import { isAbortError, isRecord, LINKEDIN_ACCESS_TOKEN_URL, LINKEDIN_AUTHORIZATION_URL, LINKEDIN_OAUTH_SCOPES, LINKEDIN_USERINFO_URL, OAUTH_PROVIDER_LINKEDIN, parseLinkedInTokenResponse } from './linkedin-oauth.service';

export interface AuthUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  fullname: string;
  avatar_url: string | null;
  country: string;
  role: UserRole;
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

/** Normalized profile used by OAuth callbacks (Google, LinkedIn, etc.). */
export interface OAuthProfilePayload {
  providerId: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly verificationOtpService: VerificationOtpService,
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
      role: dto.role,
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

    if (!user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

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

  async issueSessionForUser(
    userId: string,
    message: string,
  ): Promise<AuthResult> {
    const user = await this.usersService.findOne(userId);
    return this.issueTokens(user, message);
  }

  toResponse(session: AuthSession): AuthResponse {
    return {
      message: session.message,
      status: 'success',
      data: session.data,
    };
  }

  createLinkedInOAuthStart(): { authorizationUrl: string; state: string } {
    const clientIdRaw = env.LINKEDIN_CLIENT_ID;
    const redirectUriRaw = env.LINKEDIN_REDIRECT_URI;
    if (!clientIdRaw || !redirectUriRaw) {
      throw new ServiceUnavailableException(
        'LinkedIn OAuth is not configured',
      );
    }

    const state = randomUUID();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientIdRaw,
      redirect_uri: redirectUriRaw,
      scope: LINKEDIN_OAUTH_SCOPES,
      state,
    });

    return {
      authorizationUrl: `${LINKEDIN_AUTHORIZATION_URL}?${params.toString()}`,
      state,
    };
  }

  applyLinkedInOAuthStart(response: ExpressResponse): void {
    const start = this.createLinkedInOAuthStart();
    setLinkedInOAuthStateCookie(response, start.state);
    response.redirect(start.authorizationUrl);
  }

  async handleLinkedInOAuthCallback(
    request: ExpressRequest,
    response: ExpressResponse,
    query: { code?: string; state?: string; error?: string },
  ): Promise<void> {
    const frontend = this.getFrontendOrigin();

    const redirectWithError = (key: string): void => {
      clearLinkedInOAuthStateCookie(response);
      response.redirect(`${frontend}/login?error=${key}`);
    };

    if (query.error || !query.code || !query.state) {
      redirectWithError('oauth_cancelled');
      return;
    }

    try {
      const result = await this.completeLinkedInOAuth({
        code: query.code,
        state: query.state,
        stateCookie: readCookie(request, LINKEDIN_OAUTH_STATE_COOKIE),
      });
      clearLinkedInOAuthStateCookie(response);
      setAuthCookies(response, result.tokens);

      response.redirect(
        HttpStatus.FOUND,
        `${this.getFrontendOrigin()}${this.getPostLoginRedirectPath(result.data.user)}`,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : JSON.stringify(error);
      this.logger.warn(`LinkedIn OAuth callback failed: ${message}`);

      const key =
        error instanceof BadRequestException &&
        error.message === 'Invalid OAuth state'
          ? 'oauth_state_mismatch'
          : 'oauth_failed';

      redirectWithError(key);
    }
  }

  /**
   * Returns OAuth row, auto-link by email, or new user.
  */
  async finalizeOAuthLogin(
    provider: string,
    profile: OAuthProfilePayload,
  ): Promise<AuthResult> {
    const user = await this.usersService.resolveOAuthUserFromProviderProfile(
      provider,
      profile,
    );
    return this.issueTokens(user, 'Login successful');
  }

  async completeLinkedInOAuth(params: {
    code: string;
    state: string;
    stateCookie: string | undefined;
  }): Promise<AuthResult> {
    if (!params.stateCookie || !params.state) {
      throw new BadRequestException('Invalid OAuth state');
    }
    const stateBuffer = Buffer.from(params.state);
    const cookieBuffer = Buffer.from(params.stateCookie);
    if (stateBuffer.byteLength !== cookieBuffer.byteLength) {
      throw new BadRequestException('Invalid OAuth state');
    }
    if (!timingSafeEqual(stateBuffer, cookieBuffer)) {
      throw new BadRequestException('Invalid OAuth state');
    }

    const accessToken = await this.exchangeLinkedInCode(params.code);
    const profile = await this.fetchLinkedInUserInfo(accessToken);
    return this.finalizeOAuthLogin(OAUTH_PROVIDER_LINKEDIN, profile);
  }

  getFrontendOrigin(): string {
    return env.CORS_ORIGIN.split(',')[0]?.trim() || 'http://localhost:3000';
  }

  /** Post-login redirect based on the user's persisted role. */
  private getPostLoginRedirectPath(user: AuthUser): string {
    if (!user.onboardingComplete) {
      switch (user.role) {
        case UserRole.CANDIDATE:
          return '/candidate/onboarding';
        case UserRole.EMPLOYER:
          return '/employer/onboarding';
        default:
          return '/dashboard';
      }
    }

    switch (user.role) {
      case UserRole.CANDIDATE:
        return '/dashboard';
      case UserRole.EMPLOYER:
        return '/discovery';
      case UserRole.ADMIN:
        return '/admin';
      default:
        return '/dashboard';
    }
  }

  private async linkedInFetch(
    url: string,
    init: Omit<RequestInit, 'signal'>,
  ): Promise<globalThis.Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, linkedInHttpTimeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err: unknown) {
      clearTimeout(timer);
      if (isAbortError(err)) {
        throw new GatewayTimeoutException('LinkedIn request timed out');
      }
      throw err;
    }
  }

  private async linkedInReadResponseTextCapped(
    res: globalThis.Response,
  ): Promise<string> {
    const maxBytes = linkedInHttpMaxBodyBytes;
    if (res.body === null) {
      return '';
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let out = '';
    try {
      while (true) {
        const raw = (await reader.read()) as {
          done: boolean;
          value?: Uint8Array;
        };
        if (raw.done) {
          break;
        }
        const chunk = raw.value;
        if (chunk === undefined || chunk.byteLength === 0) {
          continue;
        }
        received += chunk.byteLength;
        if (received > maxBytes) {
          //await reader.cancel('Response body too large');
          throw new PayloadTooLargeException('LinkedIn response body too large');
        }
        out += decoder.decode(chunk, { stream: true });
      }
      out += decoder.decode();
      reader.releaseLock();
      return out;
    } catch (err: unknown) {
      await reader.cancel('Read error');
      throw err;
    }
  }

  private async linkedInReadJsonResponse(
    res: globalThis.Response,
  ): Promise<unknown> {
    const text = await this.linkedInReadResponseTextCapped(res);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new BadRequestException('LinkedIn returned invalid JSON');
    }
  }

  private async exchangeLinkedInCode(code: string): Promise<string> {
    const clientId = env.LINKEDIN_CLIENT_ID;
    const clientSecret = env.LINKEDIN_CLIENT_SECRET;
    const redirectUri = env.LINKEDIN_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) {
      throw new ServiceUnavailableException(
        'LinkedIn OAuth is not fully configured',
      );
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });

    const tokenResponse = await this.linkedInFetch(LINKEDIN_ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const tokenBody = await this.linkedInReadJsonResponse(tokenResponse);
    const tokenJson = parseLinkedInTokenResponse(tokenBody);

    if (!tokenResponse.ok || !tokenJson) {
      let errMsg = 'LinkedIn token exchange failed';
      if (isRecord(tokenBody)) {
        const fromBody =
          typeof tokenBody.error_description === 'string'
            ? tokenBody.error_description
            : typeof tokenBody.error === 'string'
              ? tokenBody.error
              : undefined;
        if (fromBody) errMsg = fromBody;
      }
      throw new BadRequestException(errMsg);
    }

    return tokenJson.access_token;
  }

  private async fetchLinkedInUserInfo(
    accessToken: string,
  ): Promise<OAuthProfilePayload> {
    const profileResponse = await this.linkedInFetch(LINKEDIN_USERINFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const body = await this.linkedInReadJsonResponse(profileResponse);

    if (!profileResponse.ok || !isRecord(body)) {
      throw new BadRequestException('Failed to load LinkedIn profile');
    }

    const sub = typeof body.sub === 'string' ? body.sub : '';
    const emailRaw = typeof body.email === 'string' ? body.email : '';
    const given =
      typeof body.given_name === 'string' ? body.given_name : undefined;
    const family =
      typeof body.family_name === 'string' ? body.family_name : undefined;
    const name = typeof body.name === 'string' ? body.name : undefined;
    const picture = typeof body.picture === 'string' ? body.picture : null;

    if (!sub || !emailRaw) {
      throw new BadRequestException('LinkedIn profile missing required fields');
    }

    let firstName = given ?? '';
    let lastName = family ?? '';
    if (!firstName && !lastName && name) {
      const parts = name.trim().split(/\s+/);
      firstName = parts[0] ?? 'User';
      lastName = parts.slice(1).join(' ') || '';
    }
    if (!firstName) {
      firstName = emailRaw.split('@')[0] ?? 'User';
    }

    return {
      providerId: sub,
      email: emailRaw.toLowerCase().trim(),
      firstName,
      lastName,
      avatarUrl: picture,
    };
  }

  private async issueTokens(user: User, message: string): Promise<AuthResult> {
    const tokens = await this.signTokens(user);
    await this.persistRefreshToken(user.id, tokens.refreshToken);

    return {
      message,
      data: {
        user: this.toAuthUser(user),
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
