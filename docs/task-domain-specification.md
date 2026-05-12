# Task Submission Domain Specification

## Overview

The task submission domain enables talents to submit practical project work (GitHub repositories, Figma designs, etc.) for manual admin scoring. This domain operates independently from the assessment system but requires talents to have attempted at least one assessment (rite of passage check).

## Domain Boundaries

### Task Submission Domain Owns

- Task submission records (file uploads + external links)
- Submission status lifecycle (pending → under_review → approved/rejected)
- Score and feedback from admin reviewers
- Multiple parallel submissions per talent
- File upload to S3 for task deliverables

### Task Submission Domain Does NOT Own

- Assessment creation and completion logic
- Admin review UI and workflows (separate admin module)
- Notification delivery (uses notification service)
- Composite scoring calculations
- Talent profile readiness status updates

## Core Entities

### `task_submissions`

```sql
CREATE TABLE task_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  talent_profile_id UUID NOT NULL REFERENCES talent_profiles(id) ON DELETE CASCADE,
  assessment_id UUID REFERENCES assessments(id) ON DELETE SET NULL,
  file_url VARCHAR(500),
  external_link VARCHAR(500),
  submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  status submission_status NOT NULL DEFAULT 'pending',
  score INT,
  feedback TEXT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE
);
```

**Status Enum**: `pending | under_review | approved | rejected`

**Constraints**:

- At least one of `file_url` or `external_link` must be provided (enforced in service layer)
- `assessment_id` is nullable - tasks are not directly linked to specific assessments

### `assessments` (Minimal Shell)

```sql
CREATE TABLE assessments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  talent_profile_id UUID NOT NULL REFERENCES talent_profiles(id) ON DELETE CASCADE,
  attempt_number INT NOT NULL DEFAULT 1,
  status assessment_status NOT NULL DEFAULT 'in_progress',
  tab_switch_flagged BOOLEAN DEFAULT FALSE,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);
```

**Purpose**: Provides FK relation for future use and enables "rite of passage" check (has talent attempted any assessment?).

## Business Rules

### Submission Rules

1. **Assessment Prerequisite**: Talent must have at least one assessment record (any status) before submitting tasks
   - Check: `COUNT(*) FROM assessments WHERE talent_profile_id = ?` must be > 0
   - This is a one-time gate, not a per-submission requirement

2. **Parallel Submissions Allowed**: Talents can submit multiple different tasks simultaneously
   - No queue or locking mechanism
   - Each submission is independent

3. **Immutable Submissions**: Once created, a submission cannot be modified
   - Status, score, and feedback can only be updated by admins during review
   - If talent wants to revise, they submit a new task

4. **Dual Submission Methods**:
   - File upload: Uploaded to S3, stored in `file_url`
   - External link: GitHub, Figma, etc., stored in `external_link`
   - Can provide both in one submission

5. **Admin Scoring**: Only users with admin role can update submission status
   - Must transition from `pending` or `under_review`
   - Cannot re-score `approved` or `rejected` submissions

## Status State Machine

```
pending ──────────┐
                  │
                  v
           under_review ───┬──> approved
                           │
                           └──> rejected
```

**Transitions**:

- `pending` → `under_review` (admin starts review)
- `under_review` → `approved` (admin approves with score)
- `under_review` → `rejected` (admin rejects with feedback)
- No backward transitions allowed

## API Surface

### Talent Endpoints

#### POST /api/v1/tasks/submit

Submit a new task with file upload or external link.

**Auth**: Requires JWT, Role: TALENT

**Request**: `multipart/form-data`

```
file: binary (optional) - .zip, .pdf, .jpg, .png, .gif (max 50MB)
externalLink: string (optional) - URL to GitHub, Figma, etc.
track: string (optional) - Role track identifier
```

**Response** (201):

```json
{
  "message": "Task submitted successfully",
  "id": "uuid",
  "status": "pending",
  "submittedAt": "2026-05-12T17:30:00Z",
  "externalLink": "https://github.com/user/repo",
  "fileUrl": "https://s3.amazonaws.com/bucket/file.zip"
}
```

**Errors**:

- 400: Neither file nor external link provided
- 400: Must attempt assessment first
- 422: Invalid URL format or file type

#### GET /api/v1/tasks/status

Get latest submission and total submission count.

**Auth**: Requires JWT, Role: TALENT

**Response** (200):

```json
{
  "latestSubmission": {
    "id": "uuid",
    "status": "under_review",
    "submittedAt": "2026-05-12T10:30:00Z",
    "externalLink": "https://github.com/...",
    "fileUrl": null,
    "score": null,
    "feedback": null
  },
  "totalSubmissions": 5
}
```

#### GET /api/v1/tasks/my-submissions

Retrieve all task submissions for the current talent.

**Auth**: Requires JWT, Role: TALENT

**Response** (200):

```json
{
  "submissions": [
    {
      "id": "uuid",
      "externalLink": "https://github.com/...",
      "fileUrl": "https://s3.amazonaws.com/...",
      "submittedAt": "2026-05-12T10:30:00Z",
      "status": "approved",
      "score": 85,
      "feedback": "Great work!"
    }
  ],
  "total": 5
}
```

### Admin Endpoints (Future - Out of Current Scope)

- `PATCH /api/v1/admin/tasks/:id/review` - Update submission status, score, feedback
- `GET /api/v1/admin/tasks` - List all submissions with filters (status, talent, date range)
- `GET /api/v1/admin/tasks/:id` - Get single submission with full details

## Security and Permissions

### Talent Permissions

- Can submit unlimited tasks (no rate limiting currently)
- Can view only their own submissions
- Cannot modify submitted tasks
- Cannot set or change their own scores
- Cannot see who reviewed their submissions

### Admin Permissions (Future)

- Can view all submissions from all talents
- Can update submission status (pending/under_review → approved/rejected)
- Can assign scores (0-100)
- Can provide feedback text
- Cannot delete submissions

## File Upload Specifications

### Allowed File Types

- Archives: `application/zip`, `application/x-zip-compressed`
- Documents: `application/pdf`
- Images: `image/jpeg`, `image/png`, `image/gif`

### Size Limits

- Maximum file size: 50 MB per upload
- No limit on number of submissions

### Storage

- Files uploaded to S3 via `UploadService`
- Reuses existing avatar upload infrastructure
- File URL stored in `task_submissions.file_url`

## Assessment Integration

### Minimal Integration Approach

Tasks are **not directly linked** to specific assessments. The relationship is minimal:

1. **Prerequisite Check**: Talent must have attempted at least one assessment (simple count query)
2. **No Status Dependency**: Assessment can be in any status (in_progress, completed, flagged)
3. **No Linkage**: `assessment_id` in task_submissions is typically NULL
4. **Independent Lifecycle**: Deleting an assessment does not prevent task submission (SET NULL on FK)

### Rationale

Assessments are exams (rite of passage). Tasks are practical projects. They measure different competencies and operate independently after the initial gate check.

## Notification Integration

### When Notifications Are Sent

- **Admin scores task**: Talent receives notification when status changes to `approved` or `rejected`
- **Notification payload**: Includes submission ID, new status, score (if applicable)

### Implementation Status

- Notification creation is TODO in `TasksService.updateSubmissionStatus()`
- Will use existing `notifications` table from database schema
- Requires NotificationsService implementation (future work)

## Module Structure

```
src/modules/tasks/
├── tasks.module.ts          # Module configuration
├── tasks.controller.ts      # REST API endpoints (talent-facing)
├── tasks.service.ts         # Business logic
├── entities/
│   └── task-submission.entity.ts  # TaskSubmission entity + enum
├── dto/
    ├── submit-task.dto.ts          # Input validation for submission
    ├── task-response.dto.ts        # Response shapes
    └── update-task-status.dto.ts   # Admin scoring input (future use)
```

### Dependencies

- `TalentModule` → for TalentProfile entity access
- `UploadModule` → for S3 file uploads
- `UsersModule` → for User entity (reviewed_by relation)
- `TypeOrmModule` → for TaskSubmission, Assessment, TalentProfile repositories

## Future Considerations

### Pagination

- `GET /api/v1/tasks/my-submissions` should add pagination when submission count grows
- Consider limit/offset or cursor-based pagination

### Task Templates

- Predefine task requirements per role track
- Store rubrics for scoring consistency
- Auto-suggest next tasks based on skill gaps

### Automated Testing

- Integrate code quality analysis for GitHub submissions
- Run automated tests for submitted code
- Provide instant feedback on technical requirements

### Batch Operations

- Allow admins to score multiple submissions at once
- Bulk status updates with consistent feedback templates

### Analytics

- Track submission trends per role track
- Average scores by track and time period
- Identify common failure patterns

### Submission History UI

- Visual timeline of submissions
- Comparison view between attempts
- Progress tracking dashboard

## Rollout Checklist

✅ Phase 1: Database & Entities

- [x] Create migration for assessments and task_submissions tables
- [x] Create Assessment entity shell
- [x] Create TaskSubmission entity
- [x] Run migration successfully

✅ Phase 2: Module Scaffold

- [x] Create tasks module directory structure
- [x] Create SubmitTaskDto
- [x] Create response DTOs
- [x] Create UpdateTaskStatusDto (for future admin use)

✅ Phase 3: Business Logic

- [x] Implement TasksService.submitTask()
- [x] Implement TasksService.getMySubmissions()
- [x] Implement TasksService.getSubmissionStatus()
- [x] Implement TasksService.updateSubmissionStatus() (admin method)

✅ Phase 4: API Endpoints

- [x] POST /api/v1/tasks/submit
- [x] GET /api/v1/tasks/status
- [x] GET /api/v1/tasks/my-submissions

✅ Phase 5: Module Wiring

- [x] Configure TasksModule imports
- [x] Register TasksModule in AppModule
- [x] Verify server starts without errors

⏳ Phase 6: Testing (Next Steps)

- [ ] Manual API testing with Postman/Swagger
- [ ] Unit tests for service methods
- [ ] E2E tests for full submission flow

⏳ Phase 7: Admin Endpoints (Future Work)

- [ ] Create admin module or admin routes in tasks module
- [ ] Implement scoring endpoints with admin role guard
- [ ] Add list/filter endpoints for admin dashboard

⏳ Phase 8: Notifications (Future Work)

- [ ] Create NotificationsService
- [ ] Integrate notification creation in updateSubmissionStatus()
- [ ] Add notification endpoints for talents to view/mark as read

## Open Questions

1. **Admin Module Structure**: Should admin endpoints live in tasks module or separate admin module?
   - **Recommendation**: Separate admin module for better separation of concerns

2. **Submission Limits**: Should we implement rate limiting or daily submission caps?
   - **Recommendation**: Monitor usage first, add limits if abuse detected

3. **Score Weighting**: How should task scores factor into overall talent readiness?
   - **Recommendation**: Define in separate composite scoring specification

4. **File Storage Costs**: How long should we retain uploaded files?
   - **Recommendation**: Keep indefinitely unless storage costs become prohibitive

5. **Retake Policy**: Can talents resubmit for the same task requirement?
   - **Current**: Yes, unlimited resubmissions allowed
   - **Recommendation**: Consider adding attempt tracking per task type
