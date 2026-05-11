# Employer Discovery Feature - Integration Guide

## What this adds

This PR implements the **Employer Discovery and Search** feature for SkillBridge backend.

### New endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/v1/employer/me | Get employer profile |
| POST | /api/v1/employer/onboarding | Complete company onboarding |
| PATCH | /api/v1/employer/me | Update employer profile |
| GET | /api/v1/employer/discovery | Browse verified candidates |
| GET | /api/v1/employer/candidates/:id | Get single candidate profile |
| POST | /api/v1/employer/shortlists/:candidateId | Shortlist a candidate |
| DELETE | /api/v1/employer/shortlists/:candidateId | Remove from shortlist |
| GET | /api/v1/employer/shortlists | Get my shortlist |
| POST | /api/v1/employer/contacts/:candidateId | Initiate contact |
| GET | /api/v1/employer/contacts | View contact history |

All endpoints require a valid JWT with `role: employer`.

---

## Integration steps

### 1. Copy new files into the existing project

Copy the following into their matching paths in `skillbridge-be`:

```
src/modules/employer/              <-- entire folder
src/modules/candidate/             <-- entire folder (talent-profile entity)
src/database/migrations/1778450000000-CreateEmployerFeatureTables.ts
```

### 2. Update app.module.ts

Replace your `src/app.module.ts` with the one provided, or manually add:

```typescript
import { EmployerModule } from './modules/employer/employer.module';

// In @Module({ imports: [...] })
EmployerModule,
```

### 3. Run the migration

```bash
pnpm run migration:run
```

This creates four tables: `talent_profiles`, `employer_profiles`, `shortlists`, `employer_contacts`.

### 4. Register as an employer user

During registration, pass `role: "employer"` in the request body, or update an existing user's role in the DB for testing.

---

## Discovery filter examples

```
GET /api/v1/employer/discovery
GET /api/v1/employer/discovery?roleTrack=frontend
GET /api/v1/employer/discovery?roleTrack=data&status=job_ready
GET /api/v1/employer/discovery?country=Nigeria&page=2&limit=10
```

---

## Business rules enforced

- Only `employer` role users can access any `/employer/*` endpoint (RolesGuard).
- Onboarding must be complete before discovery, shortlisting, or contact.
- Only published profiles with status `emerging` or `job_ready` are discoverable.
- Contact initiation is restricted to `job_ready` candidates only.
- Shortlisting the same candidate twice returns 409.
- Contacting the same candidate twice returns 409.
- All contact events are auditable via the `employer_contacts` table.

---

## Running the project locally

```bash
cp .env.example .env
# fill in DB credentials and JWT secrets

pnpm install
pnpm run migration:run
pnpm run start:dev
```

Swagger docs: http://localhost:3000/api/docs

---

## Deploying for a live URL (Render / Railway)

1. Push your branch to GitHub.
2. Create a new Web Service on [Render](https://render.com) or [Railway](https://railway.app).
3. Connect your GitHub repo.
4. Set environment variables from `.env.example`.
5. Set the build command: `pnpm install && pnpm build`
6. Set the start command: `node dist/main`
7. Add a PostgreSQL database add-on and copy the connection string into your env vars.
8. Deploy. Your live URL will be the base for your submission (e.g. `https://skillbridge-be.onrender.com/api/v1`).

> The Swagger UI at `/api/docs` serves as your live demo for the presentation.
