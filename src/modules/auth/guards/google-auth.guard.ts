import {
  BadRequestException,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import {
  clearOAuthSignupRoleCookie,
  setOAuthSignupRoleCookie,
} from '../auth.cookies';
import { isOAuthSignupRole } from '../oauth-signup-role';

@Injectable()
export class GoogleOAuthGuard extends AuthGuard('google') {
  constructor() {
    super({
      accessType: 'offline',
    });
  }

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<
      Request & {
        params?: { role?: string };
      }
    >();
    const response = context.switchToHttp().getResponse<Response>();
    const path = request.path ?? '';
    const role = request.params?.role;

    if (!path.includes('/google/signup/')) {
      return super.canActivate(context);
    }

    if (role !== undefined) {
      if (!isOAuthSignupRole(role)) {
        throw new BadRequestException('Invalid OAuth signup role');
      }
      setOAuthSignupRoleCookie(response, role);
    } else {
      clearOAuthSignupRoleCookie(response);
    }

    return super.canActivate(context);
  }
}
