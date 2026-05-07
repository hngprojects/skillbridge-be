import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { env } from '../../../config/env';
import { UsersService } from '../../users/users.service';
import { ACCESS_TOKEN_COOKIE, readCookie } from '../auth.cookies';
import { UserRole } from '../../users/entities/user.entity';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  onboardingComplete: boolean;
  jti: string;
}

const cookieExtractor = (request: Request): string | null =>
  readCookie(request, ACCESS_TOKEN_COOKIE) ?? null;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly usersService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: env.JWT_ACCESS_SECRET,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.usersService.findOneOrNull(payload.sub);
    if (!user) throw new UnauthorizedException('Invalid access token');
    return {
      sub: user.id,
      email: user.email,
      role: user.role,
      onboardingComplete: user.onboarding_complete,
    };
  }
}
