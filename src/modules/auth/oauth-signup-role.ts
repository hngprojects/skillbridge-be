import { UserRole } from '../users/entities/user.entity';

export type OAuthSignupRole = UserRole.CANDIDATE | UserRole.EMPLOYER;

export const OAUTH_SIGNUP_ROLES = [
  UserRole.CANDIDATE,
  UserRole.EMPLOYER,
] as const;

export function isOAuthSignupRole(
  value: string | undefined,
): value is OAuthSignupRole {
  return (
    value === UserRole.CANDIDATE || value === UserRole.EMPLOYER
  );
}
