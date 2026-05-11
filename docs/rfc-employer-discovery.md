# RFC: Employer Discovery and Contact

Author: Larry David
Date: 2026-05-10
Status: Draft

## Problem statement

Employers can sign up and complete onboarding, but there is no backend support for employer discovery or contact. We have employer profiles in the schema, yet no endpoints to browse candidates, shortlist them, or initiate contact. This blocks the core value loop for employers and leaves the employer domain incomplete.

We need a backend feature that lets employers:
- view their company profile
- browse published candidates
- shortlist candidates
- initiate contact with job-ready candidates

## Proposed solution

Build the Employer Discovery backend inside the existing employer module using current tables and auth rules.

High level behavior:
- Employers are authenticated by existing JWT cookie auth.
- Employers must have completed onboarding (users.onboarding_complete = true) and have an employer profile.
- Discovery reads from candidate_profiles joined to users for display fields.
- Shortlist and contact are stored in new tables that reference employer_profiles and candidate_profiles.

Data model changes:
- Add tables shortlists and employer_contacts.
- Reuse candidate_profiles and employer_profiles.

No change to auth cookies, token shape, or role model.

## Cross-track impact

Frontend:
- New employer dashboard screens: discovery list, candidate detail, shortlist view, contact history.
- Query params for filters and pagination.
- UI states for conflict and permission errors.

Design:
- Discovery card layout and filter states.
- Shortlist and contact interaction patterns.

PM:
- Confirm visibility rules (only published and emerging or job_ready).
- Confirm whether contact messages are required in v1.

## Alternatives considered

1) New talent_profiles read model table (denormalized copy)
- Pros: optimized discovery query
- Cons: duplicates candidate_profiles, adds sync complexity, and diverges from current schema
- Decision: reject for v1

2) Place discovery inside candidate module
- Pros: data already owned by candidate module
- Cons: mixes employer workflows into candidate domain and blurs boundaries
- Decision: reject

3) External search service (e.g., Elastic)
- Pros: better search at scale
- Cons: heavy infra cost and high setup time for Stage 5
- Decision: defer

## API contract

Base path: /api/v1/employer
Auth: JWT cookies, employer role required

### GET /me
Returns the employer profile.

Response 200:
```json
{
  "id": "uuid",
  "user_id": "uuid",
  "company_name": "Acme Labs",
  "company_size": "11-50",
  "industry": "Fintech",
  "website_url": "https://acme.example",
  "company_description": "...",
  "hiring_region": "Africa",
  "created_at": "2026-05-10T00:00:00.000Z",
  "updated_at": "2026-05-10T00:00:00.000Z"
}
```

Errors: 401, 403, 404

### PATCH /me
Update employer profile fields.

Request:
```json
{
  "companyName": "Acme Labs",
  "companySize": "11-50",
  "industry": "Fintech",
  "websiteUrl": "https://acme.example",
  "companyDescription": "...",
  "hiringRegion": "Africa"
}
```

Response 200: updated employer profile

Errors: 401, 403, 404, 400

### GET /discovery
Browse published candidate profiles.

Query params:
- roleTrack (string)
- status (emerging | job_ready)
- country (string)
- page (number, default 1)
- limit (number, default 20)

Response 200:
```json
{
  "payload": [
    {
      "id": "uuid",
      "roleTrack": "frontend",
      "status": "job_ready",
      "bio": "...",
      "profileShareLink": "...",
      "publishedAt": "2026-05-10T00:00:00.000Z",
      "firstName": "Ada",
      "lastName": "Lovelace",
      "country": "Nigeria",
      "avatarUrl": null,
      "isShortlisted": false,
      "contactStatus": null,
      "createdAt": "2026-05-10T00:00:00.000Z"
    }
  ],
  "paginationMeta": {
    "total": 40,
    "page": 1,
    "limit": 20,
    "totalPages": 2
  }
}
```

Errors: 401, 403

### GET /candidates/:candidateId
Returns a single candidate profile with the same shape as discovery.

Errors: 401, 403, 404

### GET /shortlists
Returns the employer shortlist (paginated).

Errors: 401, 403

### POST /shortlists/:candidateId
Adds a candidate to shortlist.

Response 201:
```json
{
  "message": "Candidate added to shortlist"
}
```

Errors: 401, 403, 404, 409

### DELETE /shortlists/:candidateId
Removes a candidate from shortlist.

Response 200:
```json
{
  "message": "Candidate removed from shortlist"
}
```

Errors: 401, 403, 404

### POST /contacts/:candidateId
Creates a contact request for a job_ready candidate.

Response 201:
```json
{
  "message": "Contact request sent"
}
```

Errors: 401, 403, 404, 409

### GET /contacts
Returns contact history (paginated).

Errors: 401, 403

## Risks and open questions

- Discovery query performance at scale (needs indexes on candidate_profiles status and published).
- Candidate data visibility rules may change; field list could shrink or expand.
- Should contact include a message in v1 or be a simple request record.
- Quotas and rate limits are not included in v1.

## Definition of done

- RFC approved and checked in.
- New migration creates shortlists and employer_contacts.
- Employer module exposes all endpoints above.
- Swagger docs updated and verified.
- Tests cover at least discovery and shortlist flows.
- System design doc published with data flow diagram.
