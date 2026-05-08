import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.register(dto);
    setAuthCookies(response, result.tokens);
    return this.authService.toResponse(result);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with email and password' })
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
