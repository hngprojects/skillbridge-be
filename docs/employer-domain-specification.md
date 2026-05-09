# Employer Domain Specification

## Overview

The employer domain owns the company-side workflow in SkillBridge after authentication:

- employer onboarding
- company profile management
- candidate discovery state
- shortlist management
- contact initiation
- employer-facing notifications

This domain should stay separate from auth and from candidate readiness logic. Employer consumes verified talent data but does not define it.

## Domain Boundaries

Employer should own:

- employer profile record
- company metadata
- employer onboarding completion for company setup
- shortlist state
- employer-to-candidate contact initiation

Employer should not own:

- authentication and token lifecycle
- candidate assessment, scoring, or readiness calculation
- candidate profile publishing rules
- admin moderation policy

## Core Entities

### `users`

Employer depends on `users` but does not replace it.

Required assumptions:

- `users.role` must support `employer`
- one `users` record maps to at most one employer profile

### `employer_profiles`

Recommended shape:

```sql
CREATE TABLE employer_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  company_name VARCHAR(255) NOT NULL,
  company_size VARCHAR(50),
  industry VARCHAR(100),
  website_url VARCHAR(255),
  company_description TEXT,
  hiring_region VARCHAR(100),
  onboarding_step VARCHAR(50),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### `shortlists`

Shortlist state belongs to employer workflows:

```sql
CREATE TABLE shortlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_profile_id UUID NOT NULL REFERENCES employer_profiles(id) ON DELETE CASCADE,
  talent_profile_id UUID NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  saved_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (employer_profile_id, talent_profile_id)
);
```

### `employer_contacts`

Contact initiation should be explicit and auditable:

```sql
CREATE TABLE employer_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_profile_id UUID NOT NULL REFERENCES employer_profiles(id) ON DELETE CASCADE,
  talent_profile_id UUID NOT NULL REFERENCES candidate_profiles(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  initiated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

## Module Layout

Recommended Nest module shape:

```text
src/modules/employer/
  employer.module.ts
  employer.controller.ts
  employer.service.ts
  dto/
  entities/
  actions/
```

If shortlist and contact workflows become large, split them later into:

- `employer-shortlists`
- `employer-contacts`

Do not split too early unless multiple services or teams need it.

## API Surface

Initial endpoints:

- `GET /api/v1/employer/me`
- `PATCH /api/v1/employer/me`
- `POST /api/v1/employer/onboarding`
- `GET /api/v1/employer/discovery`
- `POST /api/v1/employer/shortlists/:candidateId`
- `DELETE /api/v1/employer/shortlists/:candidateId`
- `GET /api/v1/employer/shortlists`
- `POST /api/v1/employer/contacts/:candidateId`

Likely future endpoints:

- `GET /api/v1/employer/contacts`
- `GET /api/v1/employer/candidates/:candidateId`
- `GET /api/v1/employer/analytics`

## Business Rules

- Only users with role `employer` can access employer endpoints.
- Employer profile should be created once, either:
  - immediately after employer signup, or
  - during onboarding after role selection
- Employers can only discover candidates whose profiles are published and meet visibility rules.
- Employers can shortlist a candidate only once.
- Employers should not contact candidates who are not published or whose contact state is blocked by policy.
- Candidate ranking and readiness labels are read-only from the employer perspective.

## Discovery Read Model

Employer discovery reads will eventually need a composed query across:

- `candidate_profiles`
- latest composite scores
- role track
- publication state
- shortlist state for current employer
- prior contact state for current employer

This should become a dedicated read query path. Do not overload the base employer service with every filter and join.

## Security and Permissions

- Employer can read and update only their own employer profile.
- Employer cannot see unpublished candidate profiles.
- Employer cannot mutate candidate readiness data.
- Contact events should be auditable.
- Shortlist and contact endpoints should enforce ownership through employer profile identity, not raw user id alone.

## Rollout Order

1. Add role support and employer profile schema.
2. Create employer module and `me` endpoints.
3. Add onboarding persistence for company setup.
4. Add shortlist storage and endpoints.
5. Add contact initiation flow.
6. Add candidate discovery read model and filtering.

## Open Decisions

- Should multiple employer users belong to one company later, or is one user to one employer profile enough for now?
- Should contact creation open a message thread immediately or only create a request record?
- Which candidate fields are visible to employers before contact acceptance?
- Do shortlist and contact actions need plan or quota limits in v1?
