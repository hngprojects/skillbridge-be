import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback, Profile } from 'passport-google-oauth20';
import { env } from '../../../config/env';

export interface GoogleProfile {
  email: string;
  firstName: string;
  lastName: string;
  picture: string;
  providerId: string;
  country: 'Unknown';
}

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: env.GOOGLE_CALLBACK_URL,
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): void {
    const { name, emails, photos } = profile;
    const user: GoogleProfile = {
      email: emails![0].value,
      firstName: name!.givenName,
      lastName: name!.familyName,
      picture: photos![0].value,
      providerId: profile.id,
      country: 'Unknown',
    };
    done(null, user);
  }
}
