import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env';
import { parseDurationToMs } from '../../config/duration';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

export const buildAuthCookieOptions = (maxAge: number): CookieOptions => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/',
  ...(maxAge > 0 ? { maxAge } : {}),
});

export const setAuthCookies = (
  response: Response,
  tokens: { accessToken: string; refreshToken: string },
): void => {
  response.cookie(
    ACCESS_TOKEN_COOKIE,
    tokens.accessToken,
    buildAuthCookieOptions(parseDurationToMs(env.JWT_ACCESS_EXPIRES_IN)),
  );
  response.cookie(
    REFRESH_TOKEN_COOKIE,
    tokens.refreshToken,
    buildAuthCookieOptions(parseDurationToMs(env.JWT_REFRESH_EXPIRES_IN)),
  );
};

export const clearAuthCookies = (response: Response): void => {
  const options = buildAuthCookieOptions(0);
  response.clearCookie(ACCESS_TOKEN_COOKIE, options);
  response.clearCookie(REFRESH_TOKEN_COOKIE, options);
};

export const readCookie = (
  request: Request,
  cookieName: string,
): string | undefined => {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;

  const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());
  const cookie = cookies.find((entry) => entry.startsWith(`${cookieName}=`));
  if (!cookie) return undefined;

  const value = cookie.slice(cookieName.length + 1);
  if (!value) return undefined;

  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
};
