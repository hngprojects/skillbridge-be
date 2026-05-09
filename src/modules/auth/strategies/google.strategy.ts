import { Injectable, NotFoundException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { ACCESS_TOKEN_COOKIE, readCookie } from '../auth.cookies';
import { OAuthUser } from '../../users/entities/user-oauth.entity';
import { UserRole } from '../../users/entities/user.entity';
import { AuthService } from '../auth.service';
import { env } from '../../../config/env';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private readonly authService: AuthService) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      callbackURL: 'http://127.0.0.1:3000/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }
  async validate(
    provider_id,
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<AuthenticatedUser> {
    const { name, emails, photos } = profile;
    if (name || emails || photos) {
    }
    const user = {
      email: emails[0].value,
      firstName: name.givenName,
      lastName: name.familyName,
      picture: photos[0].value,
      accessToken,
      refreshToken,
    };
    done(null, user);
  }
}
