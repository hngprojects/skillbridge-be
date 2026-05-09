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
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
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
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

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
      'Exchanges the code and sets auth cookies. On success, returns the same JSON shape as POST /auth/login (client decides routing using user.onboardingComplete, etc.).',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Same body contract as login: status, message, data.user, data.organisations',
  })
  async linkedInCallback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') oauthError?: string,
  ): Promise<void> {
    await this.authService.handleLinkedInOAuthCallback(req, res, {
      code,
      state,
      error: oauthError,
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
