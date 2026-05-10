import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiResponse,
  ApiTooManyRequestsResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { type Request, type Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import {
  clearAuthCookies,
  readCookie,
  REFRESH_TOKEN_COOKIE,
  setAuthCookies,
} from './auth.cookies';
import { AuthService } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { GoogleOAuthGuard } from './guards/google-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { LinkedInCallbackQueryDto } from './dto/linkedin-callback-query.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const linkedInCallbackQueryPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
});
import type { GoogleProfile } from './strategies/google.strategy';
import { env } from '../../config/env';
import { UserRole } from '../users/entities/user.entity';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiConflictResponse({ description: 'Email already registered' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify an email address with an OTP' })
  @ApiBadRequestResponse({ description: 'Invalid or expired otp' })
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.verifyEmail(dto);
    setAuthCookies(response, result.tokens);
    return {
      message: result.message,
      user: result.user,
    };
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend the email verification OTP' })
  @ApiBadRequestResponse({ description: 'Account is already verified' })
  @ApiTooManyRequestsResponse({
    description: 'Too many requests. Please wait before trying again.',
  })
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto);
  }

  @Public()
  @Get('linkedin')
  @ApiOperation({
    summary: 'Initiate LinkedIn OAuth',
    description: 'Redirects the browser to the LinkedIn consent screen.',
  })
  @ApiResponse({
    status: HttpStatus.FOUND,
    description: 'Redirect to LinkedIn authorization',
  })
  @ApiResponse({
    status: HttpStatus.SERVICE_UNAVAILABLE,
    description: 'LinkedIn OAuth is not configured',
  })
  linkedIn(@Res() res: Response): void {
    this.authService.applyLinkedInOAuthStart(res);
  }

  @Public()
  @Get('linkedin/callback')
  @ApiOperation({
    summary: 'LinkedIn OAuth callback',
    description:
      'Exchanges the code, sets auth cookies, then redirects to the role-based onboarding or application path.',
  })
  @ApiResponse({
    status: HttpStatus.FOUND,
    description:
      'Redirect to SPA: /candidate/onboarding or /employer/onboarding when setup is incomplete; otherwise /dashboard, /discovery, or /admin. Auth cookies set on this response.',
  })
  async linkedInCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query(linkedInCallbackQueryPipe) query: LinkedInCallbackQueryDto,
  ): Promise<void> {
    await this.authService.handleLinkedInOAuthCallback(req, res, {
      code: query.code,
      state: query.state,
      error: query.error,
    });
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email and password' })
  @ApiForbiddenResponse({
    description: 'Please verify your email to continue',
  })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(dto);
    setAuthCookies(response, result.tokens);
    return this.authService.toResponse(result);
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiTooManyRequestsResponse({
    description: 'Too many requests — limit is 5 per minute per IP',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password using a reset token' })
  @ApiBadRequestResponse({
    description: 'Invalid, expired, or already used token',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Passwords do not match',
  })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Public()
  @Get('google')
  @UseGuards(GoogleOAuthGuard)
  @ApiOperation({
    summary: 'Initiate Google OAuth',
    description: 'Redirects the browser to the Google consent screen.',
  })
  @ApiResponse({
    status: HttpStatus.FOUND,
    description: 'Redirect to Google authorization',
  })
  async googleAuth() {}

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleOAuthGuard)
  @ApiOperation({
    summary: 'Google OAuth callback',
    description:
      'Handles the Google OAuth callback, creates or logs in the user, sets auth cookies, then redirects to the appropriate dashboard based on role and onboarding status.',
  })
  @ApiResponse({
    status: HttpStatus.FOUND,
    description:
      'Redirect to frontend: /candidate/onboarding or /employer/onboarding if setup incomplete; /discovery for employers, /admin for admins, or /dashboard for candidates if complete. Auth cookies set on this response.',
  })
  async googleAuthRedirect(
    @Req() request: Request & { user: GoogleProfile },
    @Res() response: Response,
  ) {
    const result = await this.authService.googleCallback(request.user);
    setAuthCookies(response, result.tokens);
    const { role, onboardingComplete } = result.data.user;

    // redirect based on role + onboarding status
    if (!onboardingComplete) {
      if (role === UserRole.EMPLOYER) {
        return response.redirect(`${env.FRONTEND_URL}/employer/onboarding`);
      }
      return response.redirect(`${env.FRONTEND_URL}/candidate/onboarding`);
    }

    // onboarding complete - redirect to role-specific dashboard
    if (role === UserRole.EMPLOYER) {
      return response.redirect(`${env.FRONTEND_URL}/discovery`);
    }
    if (role === UserRole.ADMIN) {
      return response.redirect(`${env.FRONTEND_URL}/admin`);
    }
    return response.redirect(`${env.FRONTEND_URL}/dashboard`);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Issue new auth cookies from the refresh cookie' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = readCookie(request, REFRESH_TOKEN_COOKIE);
    const result = await this.authService.refresh(refreshToken);
    setAuthCookies(response, result.tokens);
    return {
      message: result.message,
      status: 'success',
    };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the current refresh token' })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = readCookie(request, REFRESH_TOKEN_COOKIE);
    await this.authService.logoutByRefreshToken(refreshToken);
    clearAuthCookies(response);
    return {
      message: 'Logged out',
      status: 'success',
    };
  }

  @ApiCookieAuth()
  @Get('me')
  @ApiOperation({ summary: 'Return the current authenticated user' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getProfile(user.sub);
  }
}
