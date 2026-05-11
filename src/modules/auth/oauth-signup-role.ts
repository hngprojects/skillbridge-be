import { UserRole } from '../users/entities/user.entity';

export const LEGACY_OAUTH_SIGNUP_ROLE = 'candidate' as const;

export type OAuthSignupRole = UserRole.TALENT | UserRole.EMPLOYER;

export const OAUTH_SIGNUP_ROLES = [
  UserRole.TALENT,
  UserRole.EMPLOYER,
] as const;

export function normalizeOAuthSignupRole(
  value: string | undefined,
): OAuthSignupRole | undefined {
  if (value === UserRole.TALENT || value === UserRole.EMPLOYER) {
    return value;
  }
  if (value === LEGACY_OAUTH_SIGNUP_ROLE) {
    return UserRole.TALENT;
  }
  return undefined;
}

export function isOAuthSignupRole(
  value: string | undefined,
): value is OAuthSignupRole {
  return normalizeOAuthSignupRole(value) !== undefined;
}
