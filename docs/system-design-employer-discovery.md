# System Design: Employer Discovery and Contact

Author: Larry David
Date: 2026-05-10

## Goal

Provide employer-facing discovery, shortlist, and contact flows using the existing NestJS app and PostgreSQL schema.

## Architecture overview

```
+-------------------+        +-------------------+        +----------------------+
|  Web or Mobile UI |  HTTPS |  NestJS API (v1)  |  SQL   |      PostgreSQL      |
|  /api/v1/employer | -----> |  Auth Guard +     | -----> | users                |
|                   | <----- |  Employer Module  | <----- | employer_profiles    |
+-------------------+        +-------------------+        | candidate_profiles   |
                                                         | shortlists            |
                                                         | employer_contacts     |
                                                         +----------------------+
```

## Key components

- JWT auth guard and roles guard gate all employer routes.
- EmployerController exposes profile, discovery, shortlist, and contact endpoints.
- EmployerService owns the business rules and query logic.
- TypeORM repositories load and persist data.

## Data model

- users
  - source of truth for role and onboarding status
- employer_profiles
  - company metadata
- candidate_profiles
  - candidate status, publish state, and role track
- shortlists
  - employer to candidate save list
- employer_contacts
  - employer to candidate contact requests and status

## Main flows

### Discovery

1) Client calls GET /api/v1/employer/discovery
2) Auth guard validates JWT and role
3) EmployerService checks onboarding complete
4) Query candidate_profiles joined to users
5) Enrich with shortlist and contact state
6) Return paginated candidate cards

### Shortlist

1) Client calls POST /api/v1/employer/shortlists/:candidateId
2) Service verifies onboarding and candidate visibility
3) Insert into shortlists with unique constraint
4) Return success message

### Contact

1) Client calls POST /api/v1/employer/contacts/:candidateId
2) Service verifies onboarding and candidate status is job_ready
3) Insert into employer_contacts with status = pending
4) Return success message

## Indexing and performance

- shortlists: index on employer_profile_id
- employer_contacts: index on employer_profile_id
- candidate_profiles: existing indexes on status and is_published should be added if missing

## Security

- Role based access control via RolesGuard (employer only)
- Candidate data visibility restricted to published and job_ready or emerging
- Contact only allowed for job_ready

## Observability

- Existing logging interceptor captures request metadata
- Errors are standardized by HttpExceptionFilter

## Future extensions

- Add full text search for role track and location
- Add quotas and rate limits for contact
- Add messaging thread after contact acceptance
