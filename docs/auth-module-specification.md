# Auth Module Specification

## Table of Contents

1. [Overview](#overview)
2. [User Roles](#user-roles)
3. [Signup Methods](#signup-methods)
4. [Database Schema](#database-schema)
5. [JWT Strategy](#jwt-strategy)
6. [Auth Flows](#auth-flows)
7. [API Contract](#api-contract)
8. [Business Rules](#business-rules)
9. [Security Requirements](#security-requirements)
10. [Open Decisions](#open-decisions)

---

## Overview

Auth is a Week 1 deliverable and the foundation every other SkillBridge service depends on. The assessment engine, scoring system, employer dashboard, and admin panel all gate access through JWT middleware produced by this module.

**Tech stack for this module:**

- Runtime: Node.js
- Auth: JWT (access + refresh token strategy)
- Hashing: Argon
- OAuth: Google, LinkedIn (OAuth 2.0)
- Database: PostgreSQL

---

## User Roles

SkillBridge has three distinct roles, each with a different access surface:

| Role        | Access                                                   |
| ----------- | -------------------------------------------------------- |
| `candidate` | Assessment pipeline, dashboard, verified profile         |
| `employer`  | Discovery dashboard, candidate profiles (Job Ready only) |
| `admin`     | Moderation queue, submission review, scoring oversight   |

> Admin accounts are **not self-registerable**. They are provisioned directly in the database or via an internal endpoint.

---

## Signup Methods

| Method                | Email verified?                           | Password          |
| --------------------- | ----------------------------------------- | ----------------- |
| Email/password        | Required (manual, 5 - 15 mins otp)        | Argon hash stored |
| Google/LinkedIn OAuth | Trust the provider for email verification | No password       |

---

## Database Schema

### `users`

```sql
CREATE TABLE users (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name          VARCHAR(100)  NOT NULL,
  last_name           VARCHAR(100)  NOT NULL,
  email               VARCHAR(255)  NOT NULL UNIQUE,
  password_hash       VARCHAR(255)  NULL,            -- NULL for OAuth-only accounts
  country             VARCHAR(100)  NOT NULL,
  role                VARCHAR(20)   NOT NULL DEFAULT 'candidate', -- candidate | employer | admin
  is_verified         BOOLEAN       NOT NULL DEFAULT false,
  onboarding_complete BOOLEAN       NOT NULL DEFAULT false,
  created_at          TIMESTAMP     NOT NULL DEFAULT NOW()
);
```

### `user_oauth_accounts`

Separating OAuth identities allows one user to link multiple providers (Google + LinkedIn) and still use email/password — all on the same account.

```sql
CREATE TABLE user_oauth_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     VARCHAR(20)  NOT NULL,  -- google | linkedin
  provider_id  VARCHAR(255) NOT NULL,  -- the sub/id from the provider
  created_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_id)
);
```

### `refresh_tokens`

```sql
CREATE TABLE refresh_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   VARCHAR   NOT NULL,
  expires_at   TIMESTAMP NOT NULL,
  revoked      BOOLEAN   NOT NULL DEFAULT false,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### `candidates`

```sql
CREATE TABLE candidates (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  role_track          VARCHAR(50),    -- frontend | data | design | ...
  status              VARCHAR(20) NOT NULL DEFAULT 'not_started',
  -- not_started | in_progress | not_ready | emerging | job_ready
  is_published        BOOLEAN NOT NULL DEFAULT FALSE,
  profile_share_link  VARCHAR UNIQUE,
  published_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `employers`

```sql
CREATE TABLE employers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  company_name VARCHAR(255) NOT NULL,
  company_size VARCHAR,
  industry     VARCHAR,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### `job_applications`

```sql
CREATE TABLE job_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id    UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE UNIQUE,
  role_track      VARCHAR(50),    -- frontend | data | design | ...
  description     TEXT NOT NULL,
  requirements    TEXT NOT NULL,
  submissions     TEXT NOT NULL,
  status          VARCHAR(20) NOT NULL DEFAULT 'not_published',
  -- not_published | published | closed | archived
  last_edited_at  TIMESTAMP
);
```

---

## JWT Strategy

Both tokens are stored as httpOnly cookies. The response body never contains a token — only the user object. Neither token is ever accessible to JavaScript on web, and the mobile client manages cookies manually via interceptors.

### Access Token

- **TTL:** 30 minutes
- **Storage:** `httpOnly`, `Secure`, `SameSite=Strict` cookie
- **Cookie name:** `access_token`
- **Transmitted:** Automatically by browser / manually by mobile interceptor

### Refresh Token

- **TTL:** 30 days
- **Storage:** `httpOnly`, `Secure`, `SameSite=Strict` cookie
- **Cookie name:** `refresh_token`
- **Strategy:** Rotation — every refresh call revokes the old token and issues a new one

### Response body shape (all auth endpoints)

Tokens are never returned in the response body. The client reads the user object to make routing decisions.

```json
{
  "user": {
    "id": "uuid",
    "email": "string",
    "role": "candidate | employer | admin",
    "onboardingComplete": false
  }
}
```

### JWT Payload

```json
{
  "sub": "user-uuid",
  "role": "candidate | employer | admin",
  "email": "user@email.com",
  "onboardingComplete": true,
  "iat": 1234567890,
  "exp": 1234568790
}
```

### Post-login Redirect Logic

```
1. Read role + onboardingComplete from user object in response body
2. If onboardingComplete = false → redirect to /onboarding/role-select (all roles)
3. If onboardingComplete = true:
   - candidate → /dashboard
   - employer  → /discovery
   - admin     → /admin
```

### Web vs Mobile cookie handling

|                | Web (browser)                    | Mobile (React Native / Flutter)                             |
| -------------- | -------------------------------- | ----------------------------------------------------------- |
| Cookie storage | Native browser cookie jar        | Manual — interceptor extracts from `Set-Cookie` header      |
| Cookie sending | Automatic on every request       | Manual — interceptor attaches `Cookie` header               |
| Secure storage | httpOnly (JS cannot read)        | `react-native-encrypted-storage` or `react-native-keychain` |
| Token refresh  | Automatic via interceptor on 401 | Same — Axios interceptor fires `POST /auth/refresh`         |

**Backend is identical for both.** The mobile client just does manually what the browser does automatically.

**Required config:**

```ts
// Backend CORS (Nest)
const app = await NestFactory.create(AppModule, {
  cors: {
    origin: ['https://skillbridge.com', 'http://localhost:3000'],
    methods: 'GET,POST',
  },
});
```

```ts
// Mobile Axios instance
const api = axios.create({
  baseURL: 'https://api.skillbridge.com/api/v1',
  withCredentials: true, // send/receive cookies
});
```

---

## Auth Flows

There are two distinct signup/login paths. Both converge at the same onboarding step after account creation. Each is fully documented below so the team can implement them independently.

### At a glance

|                     | Flow A — Email / Password                     | Flow B — OAuth (Google / LinkedIn)     |
| ------------------- | --------------------------------------------- | -------------------------------------- |
| Entry point         | Registration form                             | "Continue with Google/LinkedIn" button |
| Fields collected    | firstName, lastName, email, country, password | Pulled from provider profile           |
| Email verification  | Manual — 5 - 15 mins otp sent to inbox        | Automatic — provider pre-verifies      |
| Password            | Required (Argon hashed, cost 12)              | Never set (`NULL`)                     |
| Account conflict    | N/A                                           | Auto-link if email already exists      |
| After signup        | Must verify email → then onboarding           | Straight to onboarding                 |
| Onboarding required | Yes (all new users)                           | Yes (all new users)                    |

**Both paths issue the same JWT and set the same httpOnly refresh token cookie. Post-onboarding behaviour is identical regardless of how the user signed up.**

### Flow summary

```
Flow A — Email/Password
  Register → Verify email → [Onboarding] → Dashboard

Flow B — OAuth
  Click provider → Consent screen → Callback (auto-link or create) → [Onboarding if new] → Dashboard

Both flows share:
  Token Refresh (Flow C)
  Logout        (Flow D)
  Onboarding    (Flow E)
```

---

### Flow A — Email / Password

#### A1. Registration

```
POST /auth/register
  │
  ├── Validate request body (firstName, lastName, email, country, password)
  │     └── Fail → 422 { status: "error", message: "Validation failed", fields: [...] }
  │
  ├── Check if email already exists in users table
  │     └── Exists → 409 { status: "error", message: "Email already registered" }
  │
  ├── Hash password (Argon, cost factor 12)
  │
  ├── INSERT into users:
  │     { first_name, last_name, email, password_hash, country,
  │       role: null, is_verified: false, onboarding_complete: false }
  │
  ├── Generate email verification OTP (5 - 15 mins TTL)
  │     Store: { user_id, otp_hash, expires_at } in verification_otps table
  │
  └── Send verification email → OTP code
        Response: 201 { status: "success", message: "Verification otp sent" }
```

#### A2. Email Verification

```
POST /auth/verify-email
  │
  ├── Look up OTP in verification_otps
  │     ├── Not found → 400 { status: "error", message: "Invalid otp" }
  │     └── Found but expired → 400 { status: "error", message: "Otp expired. Request a new one." }
  │
  ├── Mark OTP as used
  │
  ├── UPDATE users SET is_verified = true WHERE id = user_id
  │
  ├── Issue access token (JWT, 15min) + set refresh token cookie (httpOnly, 7 days)
  │
  └── Response: 200 { status: "success", data: { id, email, onboardingComplete: false } }
        → Client redirects to /onboarding/role-select
```

#### A3. Login

```
POST /auth/login
  │
  ├── Find user WHERE email = $email
  │     └── Not found → 401 { status: "error", message: "Invalid credentials" }
  │
  ├── Check is_verified
  │     └── false → 403 { status: "error", message: "Email not verified. Check your inbox." }
  │
  ├── Compare submitted password against stored hash (Argon.compare)
  │     └── No match → 401 { status: "error", message: "Invalid credentials" }
  │
  ├── Issue access token (JWT, 15min) + set refresh token cookie (httpOnly, 7 days)
  │
  └── Response: 200 { status: "success", data: { id, email, role, onboardingComplete } }
        → Client reads onboardingComplete:
            false → redirect to /onboarding/role-select
            true  → redirect to /dashboard or /discovery based on role
```

#### A4. Password Reset

```
Step 1 — Request reset
  POST /auth/forgot-password { email }
    │
    ├── ALWAYS return 200 regardless of whether email exists
    │     { status: "success", message: "If that email exists, a reset link has been sent" }
    │
    └── If email found in users:
          Generate reset token (random UUID, 1hr TTL)
          Store: { user_id, token_hash, expires_at, used: false }
          Send reset token to user (out-of-band) — client submits it in JSON body to POST /auth/reset-password

Step 2 — Submit new password
  POST /auth/reset-password { token, password, confirmPassword }
    │
    ├── Look up token → not found/expired → 400 { status: "error", message: "Invalid or expired token" }
    ├── Check used flag → already used → 400 { status: "error", message: "Token already used" }
    ├── Validate password === confirmPassword → mismatch → 422
    │
    ├── Hash new password → UPDATE users SET password_hash = $hash
    ├── Mark token as used
    ├── REVOKE all refresh_tokens for this user (forces re-login on all devices)
    │
    └── Response: 200 { status: "success", message: "Password updated. Please log in." }
```

---

### Flow B — OAuth (Google & LinkedIn)

OAuth replaces the registration form entirely. The provider (Google or LinkedIn) supplies the user's name and email. No password is ever set. Email is considered pre-verified on account creation.

Both Google and LinkedIn follow **the exact same callback logic** — only the provider name, client credentials, and API endpoint differ. The decision tree below applies to both.

> **Key difference from Flow A:** There is no separate registration + verification step. The OAuth callback handles new user creation, returning user login, and account linking all in one place.

#### B1. Initiate OAuth

```
User clicks "Continue with Google" or "Continue with LinkedIn"
  │
  └── GET /auth/google  OR  GET /auth/linkedin
        │
        └── Backend redirects to provider's OAuth consent screen
              (with client_id, redirect_uri, scope: email + profile)
```

#### B2. OAuth Callback — Full Decision Tree

```
Provider redirects to:
  GET /auth/google/callback?code=...
  GET /auth/linkedin/callback?code=...&state=...
  │
  ├── Exchange authorization code for provider access token (server-side only)
  ├── Fetch user profile from provider: { provider_id, email, firstName, lastName }
  │
  ├── LOOKUP: user_oauth_accounts WHERE provider = $provider AND provider_id = $provider_id
  │
  │   ── CASE 1: OAuth account found ──────────────────────────────────────────
  │   │   This is a returning OAuth user. Fetch the linked users row.
  │   │   Issue access token + set refresh cookie.
  │   │   Response: **302** to `{CORS_ORIGIN}` + path from Post-login Redirect Logic; cookies set on response
  │   │   (onboarding incomplete → `/onboarding/role-select`; else role → `/dashboard` | `/discovery` | `/admin`)
  │   │
  │   └── OAuth account NOT found → check users WHERE email = $email
  │
  │       ── CASE 2: Email exists (existing account — auto-link) ────────────
  │       │   The user previously registered via email/password (or a different OAuth provider).
  │       │   Decision: AUTO-LINK (agreed).
  │       │
  │       │   INSERT INTO user_oauth_accounts { user_id, provider, provider_id }
  │       │   Issue access token + set refresh cookie.
  │       │   Response: **302** to Post-login Redirect path; cookies set on response
  │       │
  │       │   ⚠ If onboardingComplete = false (edge case: user registered but never finished
  │       │     onboarding) → redirect to /onboarding/role-select as usual.
  │       │
  │       └── CASE 3: Email not found (brand new user) ──────────────────────
  │               INSERT INTO users:
  │                 { first_name, last_name, email, password: NULL,
  │                   is_verified: true, onboarding_complete: false }
  │               INSERT INTO user_oauth_accounts { user_id, provider, provider_id }
  │               Issue access token + set refresh cookie.
  │               Response: **302** to `/onboarding/role-select` (new users); cookies set on response
```

#### B3. Key differences from Email/Password flow

|                    | Email / Password                  | OAuth                                      |
| ------------------ | --------------------------------- | ------------------------------------------ |
| Password           | Required (Argon hashed)           | Never set (`NULL`)                         |
| Email verification | Manual (5 - 15mins otp via email) | Automatic (`is_verified = true` on create) |
| Name collection    | From registration form            | From provider profile                      |
| Account conflict   | N/A                               | Auto-link via `user_oauth_accounts`        |
| Onboarding step    | Always required after verify      | Always required for new users              |

---

### Flow C — Token Refresh (applies to both A and B)

```
Client receives 401 on any protected endpoint (access token expired)
  │
  └── Client automatically calls POST /auth/refresh
        (refresh token sent automatically via httpOnly cookie — no JS access)
        │
        ├── Backend reads refresh token from cookie
        ├── Look up token_hash in refresh_tokens table
        │     ├── Not found → 401 { status: "error", message: "Session not found. Please log in." }
        │     ├── Expired  → 401 { status: "error", message: "Session expired. Please log in." }
        │     └── Revoked  → 401 { status: "error", message: "Session revoked. Please log in." }
        │
        ├── Valid token:
        │     REVOKE old refresh token (UPDATE refresh_tokens SET revoked = true)
        │     Issue new access token (JWT, 15min)
        │     Issue new refresh token → set new httpOnly cookie
        │     ⚠ This is token rotation — prevents refresh token replay attacks
        │
        └── Response: 200 { status: "success", message: "Token refreshed" }
              → Client retries the original failed request with new access token
```

---

### Flow D — Logout

```
POST /auth/logout
  │  Requires: access_token cookie
  │
  ├── Validate access_token cookie
  ├── Extract user_id from JWT payload
  ├── Revoke current refresh token (UPDATE refresh_tokens SET revoked = true WHERE user_id = $id)
  ├── Clear httpOnly cookie
  │
  └── Response: 200 { status: "success", message: "Logged out" }
```

---

### Flow E — Onboarding (shared by both A and B)

All new users — regardless of signup method — must complete this step before accessing their dashboard. The JWT issued before this step has `onboardingComplete: false`. After this step it is reissued as `true`.

```
POST /onboarding/role
  │  Requires: access_token cookie
  │
  ├── Validate onboardingComplete = false (if true → 403 { status: "error", message: "Already completed" })
  │
  ├── IF role = "candidate":
  │     Validate roleTrack is present and valid
  │     INSERT INTO candidates { user_id, role_track, status: "not_started" }
  │     UPDATE users SET role = "candidate", onboarding_complete = true
  │
  ├── IF role = "employer":
  │     Validate companyName is present
  │     INSERT INTO employers { user_id, company_name }
  │     UPDATE users SET role = "employer", onboarding_complete = true
  │
  ├── Reissue access token cookie with updated payload:
  │     { ..., role: "candidate|employer", onboardingComplete: true }
  │
  └── Response: 200 { redirectTo: "/dashboard" | "/discovery" }
```

---

## API Contract

**Base path:** `/api/v1`

**Content-Type:** `application/json`

**Authentication:** Handled via httpOnly cookies — no `Authorization` header needed

**Note:** All successful auth responses set `access_token` and `refresh_token` as httpOnly cookies. Tokens are never returned in the response body.

---

### `POST /auth/register`

Register with email and password.

**Request body:**

```json
{
  "firstName": "string",
  "lastName": "string",
  "email": "string",
  "country": "string",
  "password": "string (min 8 chars)"
}
```

**Responses:**

```json
201  { "status": "success", "message": "Verification otp sent" }
409  { "status": "error", "message": "Email already registered" }
422  { "status": "error", "message": "Validation failed", "fields": ["password"] }
```

---

### `POST /auth/verify-email`

Confirm email address using OTP.

**Request body:**

```json
{
  "email": "string",
  "otp": "string"
}
```

**Responses:**

```json
200  {
       "message": "Email verified",
       "status": "success",
       "user": { "id": "uuid", "email": "string", "onboardingComplete": false }
     }
400  { "status": "error", "message": "Invalid or expired otp" }
```

> Sets `access_token` and `refresh_token` as httpOnly cookies.
> Client reads `onboardingComplete` from user object and redirects to `/onboarding/role-select`.

---

### `POST /auth/resend-verification`

Resend the verification email. For users who missed or lost the original email.

**Request body:**

```json
{
  "email": "string"
}
```

**Responses:**

```json
200  { "status": "success", "message": "Verification email resent" }
400  { "status": "error", "message": "Account is already verified" }
429  { "status": "error", "message": "Too many requests. Please wait before trying again." }
```

> Rate limited — max 3 resend attempts per hour per email.

---

### `POST /auth/login`

Email/password login.

**Request body:**

```json
{
  "email": "string",
  "password": "string"
}
```

**Responses:**

```json
200  {
       "user": {
         "id":                 "uuid",
         "email":              "string",
         "role":               "candidate | employer | admin",
         "onboardingComplete": "boolean"
       }
     }
401  { "status": "error", "message": "Invalid credentials" }
403  {
       "error": "EMAIL_NOT_VERIFIED",
       "message": "Please verify your email to continue",
       "email": "user@email.com"
     }
```

> On success: sets `access_token` and `refresh_token` as httpOnly cookies.
> On `EMAIL_NOT_VERIFIED`: client redirects to "check your inbox" screen and surfaces a resend button pointing to `POST /auth/resend-verification`.

---

### `GET /auth/google`

Initiate Google OAuth flow. Redirects to Google consent screen.

**Callback:** `GET /auth/google/callback`

**Callback success response:**

```json
200  {
       "status": "success",
       "user": { "id": "uuid", "email": "string", "role": "string", "onboardingComplete": "boolean" }
     }
```

> Sets `access_token` and `refresh_token` as httpOnly cookies.

---

### `GET /auth/linkedin`

Initiate LinkedIn OAuth flow. Redirects the browser to LinkedIn’s authorization (consent) screen.

**Response:** `302 Found` — `Location` is `https://www.linkedin.com/oauth/v2/authorization` with query parameters including `client_id`, `redirect_uri`, `scope` (`openid profile email`), `state`, and `response_type=code`.

**Cookies (initiate step):** Sets `linkedin_oauth_state` (httpOnly, `SameSite=Lax`, ~10 minutes) for CSRF protection. The callback must verify the `state` query parameter against this cookie before exchanging the code.

**Environment (`src/config/env.ts`):**

`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, and `LINKEDIN_REDIRECT_URI` must be **all set** or **all omitted**. If only one or two are set, the process **fails at startup** with a **`ZodError`** (the app never listens; you will not get an HTTP `503` from the API). 

| Variable | Description |
| -------- | ----------- |
| `LINKEDIN_CLIENT_ID` | Client ID from the LinkedIn product / app |
| `LINKEDIN_CLIENT_SECRET` | Client secret (used on the callback for token exchange) |
| `LINKEDIN_REDIRECT_URI` | Full callback URL, must match the app’s authorized redirect URL (e.g. `http://localhost:3000/api/v1/auth/linkedin/callback`) |

**Errors (initiate only, after a healthy boot):**

If **all three** variables are **omitted**, the app still starts. In that case, **`GET /auth/linkedin`** cannot build the authorize URL and returns **`503`** via the global HTTP exception filter (not the raw Nest default body), for example:

```json
503  {
       "success": false,
       "status_code": 503,
       "error": "Service Unavailable",
       "message": "LinkedIn OAuth is not configured",
       "path": "/api/v1/auth/linkedin",
       "timestamp": "2026-05-09T12:00:00.000Z"
     }
```

**Callback:** `GET /auth/linkedin/callback`

**Callback success response:**

`302 Found` — `Location` is `{first CORS_ORIGIN}{path}` per **Post-login Redirect Logic**:

- `onboardingComplete === false` → `/onboarding/role-select`
- `onboardingComplete === true` and `role === candidate` → `/dashboard`
- `onboardingComplete === true` and `role === employer` → `/discovery`
- `onboardingComplete === true` and `role === admin` → `/admin`

> Sets `access_token` and `refresh_token` as httpOnly cookies on the redirect response.

**Callback error responses (browser redirect):**

The callback is a full-page browser navigation. Failures use **`302 Found`** to **`{first CORS_ORIGIN}/login`** with an `error` query param and clear **`linkedin_oauth_state`**. Do **not** expect **`503` JSON** from the callback (including `ServiceUnavailableException` from token exchange — it is caught and mapped here).

| Situation | `Location` (relative to first CORS origin) |
| --------- | -------------------------------------------- |
| CSRF / state validation: `state` query does not match the `linkedin_oauth_state` cookie, or the cookie is missing while `state` is present | `/login?error=oauth_state_mismatch` |
| User cancelled at LinkedIn, or provider returned an error, or required query params (`code`, `state`) are missing | `/login?error=oauth_cancelled` |
| Other failures after state checks (e.g. token exchange, profile fetch, or “not fully configured” at exchange) | `/login?error=oauth_failed` |

---

### `POST /auth/refresh`

Rotate access and refresh tokens.

**Request:** No body. Both tokens read from httpOnly cookies.

**Responses:**

```json
200  { "status": "success", "message": "Token refreshed" }
401  { "status": "error", "message": "Invalid or expired refresh token" }
```

> Old tokens revoked. New `access_token` and `refresh_token` set as httpOnly cookies.

---

### `POST /auth/logout`

Revoke current session.

**Request:** No body. Token read from cookie.

**Responses:**

```json
200  { "status": "success", "message": "Logged out" }
401  { "status": "error", "message": "Unauthorized" }
```

> Both httpOnly cookies cleared. Refresh token revoked in DB.

---

### `POST /auth/forgot-password`

Request a password reset link.

**Request body:**

```json
{
  "email": "string"
}
```

**Responses:**

```json
200  { "status": "success", "message": "If that email exists, a reset link has been sent" }
```

> Always returns 200 regardless of whether the email exists (prevents enumeration).

---

### `POST /auth/reset-password`

Set a new password using a reset token.

**Request body:**

```json
{
  "token": "string",
  "password": "string",
  "confirmPassword": "string"
}
```

**Responses:**

```json
200  { "status": "success", "message": "Password updated. Please log in." }
400  { "status": "error", "message": "Invalid or expired token" }
422  { "status": "error", "message": "Passwords do not match" }
```

> All active refresh tokens for the user are revoked on success.

---

### `POST /onboarding/role`

Complete role selection and profile setup. Called after email verification or first OAuth login.

**Request body — candidate:**

```json
{
  "role": "candidate",
  "roleTrack": "frontend | data | design | ..."
}
```

**Request body — employer:**

```json
{
  "role": "employer",
  "companyName": "string"
}
```

**Responses:**

```json
200  {
       "status": "success",
       "user": { "id": "uuid", "email": "string", "role": "string", "onboardingComplete": true },
       "redirectTo": "/dashboard | /discovery"
     }
400  { "status": "error", "message": "Invalid role or missing required fields" }
403  { "status": "error", "message": "Onboarding already completed" }
```

> Reissues `access_token` cookie with updated JWT payload (`role` and `onboardingComplete: true`).

---

### `GET /auth/me`

Get the currently authenticated user. Cookie sent automatically.

**Request:** No body, no Authorization header — cookie handles auth.

**Responses:**

```json
200  {
       "id":                 "uuid",
       "firstName":          "string",
       "lastName":           "string",
       "email":              "string",
       "role":               "candidate | employer | admin",
       "country":            "string",
       "onboardingComplete": "boolean",
       "isVerified":         "boolean",
       "createdAt":          "ISO 8601"
     }
401  { "status": "error", "message": "Unauthorized" }
```

---

## Business Rules

| Rule                                     | Detail                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Email verification is mandatory          | Unverified users get `EMAIL_NOT_VERIFIED` 403 on login — client starts verification flow           |
| Unverified login triggers resend flow    | Client redirects to "check your inbox" screen with resend button                                   |
| OAuth users are auto-verified            | Google and LinkedIn pre-verify emails — no verification email sent                                 |
| Role selection is required               | OAuth and email users must complete onboarding before dashboard access                             |
| Employers must supply company name       | Required field during onboarding, not optional                                                     |
| Candidates must select a role track      | Required to enter the assessment pipeline                                                          |
| Password reset revokes all sessions      | All refresh tokens for the user are revoked on reset                                               |
| Admin accounts are not self-registerable | Provisioned directly or via internal endpoint                                                      |
| Auto-link on OAuth conflict              | If OAuth email matches existing account, accounts are silently linked via `user_oauth_accounts`    |
| Tokens never in response body            | Both access and refresh tokens are httpOnly cookies only — response body contains user object only |

---

## Security Requirements

| Requirement                  | Detail                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Password hashing             | Argon, cost factor 12                                                                                                    |
| Access token storage         | `httpOnly`, `Secure`, `SameSite=Strict` cookie — 15min TTL                                                               |
| Refresh token storage        | `httpOnly`, `Secure`, `SameSite=Strict` cookie — 7 days TTL                                                              |
| Token rotation               | Refresh tokens rotate on every use — old token immediately revoked                                                       |
| Rate limiting                | `/auth/login`: 5 req/min per IP · `/auth/forgot-password`: 5 req/min · `/auth/resend-verification`: 3 per hour per email |
| Email enumeration prevention | Forgot password always returns 200 regardless of email existence                                                         |
| Token TTLs                   | Access: 15min · Refresh: 7 days · Email verify: 24hr · Password reset: 1hr                                               |
| HTTPS only                   | All auth endpoints require TLS in production                                                                             |
| CORS credentials             | `credentials: true` required on backend — mobile uses `withCredentials: true` on Axios                                   |

---

## Open Decisions

Settled decisions are marked with a check. Remaining items need team agreement before implementation.

1. **Account conflict on OAuth** — Auto-link. Handled via `user_oauth_accounts` table.
2. **Token storage** — Both tokens as httpOnly cookies. Response body contains user object only.
3. **Unverified user on login** — Return `EMAIL_NOT_VERIFIED` error code. Client starts verification flow with resend button.
4. **Resend verification endpoint** — `POST /auth/resend-verification` included. Rate limited to 3/hr per email.
5. **Mobile cookie strategy** — Mobile uses Axios interceptors to extract and attach cookies manually. Backend unchanged.
6. **Candidate role change** — A candidate can change their role track after onboarding.
7. **No session limits** — For now, the MVP, there's no session limit implemented.
