import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
<<<<<<< HEAD
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
=======
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTooManyRequestsResponse,
  ApiTags,
} from '@nestjs/swagger';
>>>>>>> feebe3cf677712cd043c1cbe989c854fa4c36c41
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
<<<<<<< HEAD
import { GoogleOAuthGuard } from './guards/google-auth.guard';
=======
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
>>>>>>> feebe3cf677712cd043c1cbe989c854fa4c36c41

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
<<<<<<< HEAD
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.register(dto);
    setAuthCookies(response, result.tokens);
    return this.authService.toResponse(result);
=======
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
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email and password' })
<<<<<<< HEAD
=======
  @ApiForbiddenResponse({
    description: 'Please verify your email to continue',
  })
>>>>>>> feebe3cf677712cd043c1cbe989c854fa4c36c41
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(dto);
    setAuthCookies(response, result.tokens);
    return this.authService.toResponse(result);
<<<<<<< HEAD
  }

  @Public()
  @Get('google')
  @UseGuards(GoogleOAuthGuard)
  async googleAuth() {}

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleOAuthGuard)
  async googleAuthRedirect(@Res({ passthrough: true }) response: Response) {
    const authResult = await this.authService.googleCallback();
    setAuthCookies(response, authResult.tokens);
    return this.authService.toResponse(authResult);
=======
>>>>>>> feebe3cf677712cd043c1cbe989c854fa4c36c41
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
