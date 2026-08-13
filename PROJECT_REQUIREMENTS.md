# DocuMind — Professional Requirements Specification

## 1. Purpose

DocuMind is a multi-tenant AI Document Intelligence platform for uploading, managing, previewing, searching, and asking questions from organization documents. The system must provide secure authentication, strict role-based access control, organization isolation, file management, auditability, and a production-ready document RAG experience.

This document converts the implemented and planned project work into a professional requirement specification.

## 2. Product Scope

### In scope

- Secure authentication and session management.
- Single platform Super Admin controlled from backend environment configuration.
- Multi-tenant organization management.
- Invitation-based user onboarding.
- Dynamic RBAC with database-managed roles and permissions.
- Organization-isolated user/member management.
- File upload, validation, preview, download, delete, version history, and listing.
- Document AI/RAG pipeline with embeddings, Qdrant vector search, reranking, citations, and chat history.
- Background cleanup, retry jobs, and operational logs.
- Security controls including validation, rate limiting, CORS, CSRF, audit logging, and secret handling.

### Currently out of scope / deferred

- Public self-signup page.
- Payment flow.
- Subscription billing management.
- Organization limits shown to end users.
- System health dashboard in frontend.
- Advanced knowledge base module, unless added later as a separate epic.
- Full conversation memory by default.

## 3. User Roles

### 3.1 Super Admin

The Super Admin is a single platform-level account configured from environment variables or database bootstrap setup.

Requirements:

- There must be only one Super Admin.
- Super Admin must not be created, promoted, assigned, or modified through the UI.
- Super Admin must not be treated as a normal organization member.
- Super Admin can view and manage platform-level data.
- Super Admin can create, update, suspend, and delete organizations.
- Super Admin can view all organizations, users, documents, queues, and audit logs.
- Super Admin can create custom roles where allowed by platform policy.
- Super Admin can manage users across organizations without becoming a member of each organization.

### 3.2 Organization Admin

Organization Admin is scoped to a single organization.

Requirements:

- Can manage members within their own organization only.
- Can invite users into their organization.
- Can assign allowed organization roles.
- Can view organization-specific audit logs.
- Cannot view Super Admin audit logs.
- Cannot access other organizations.
- Cannot create or assign Super Admin.

### 3.3 Manager

Manager is scoped to the assigned organization/team.

Requirements:

- Can upload and manage allowed documents.
- Can use AI document features if permission is granted.
- Cannot manage organization users or assign roles.
- Cannot access billing, platform settings, or other organizations.

### 3.4 Employee

Employee is scoped to their allowed documents and resources.

Requirements:

- Can upload documents if upload permission is granted.
- Can view and update own/allowed documents.
- Can ask AI from documents they are allowed to access.
- Cannot manage users, assign roles, or access organization settings.

### 3.5 Viewer

Viewer is read-only.

Requirements:

- Can view permitted documents and search shared information.
- Cannot upload, update, delete, export, or use restricted AI features unless explicitly permitted.

## 4. Epic 1 — Authentication

### 4.1 Account provisioning

The project uses invitation-based onboarding instead of open public registration.

Requirements:

- New users are created through an organization invitation.
- User receives a company-branded email containing login instructions and a one-time password or invitation flow.
- Public signup page must be removed or disabled.
- Email and name fields must be validated professionally.
- Names, roles, and organization names must not allow symbols, emojis, or unsafe characters.
- Passwords must be validated and stored only as secure hashes.

Acceptance criteria:

- A user cannot self-register from the frontend.
- A user can only join through a valid invitation.
- Expired, accepted, or revoked invitations cannot be reused.

### 4.2 Login

Requirements:

- Login must use secure password verification.
- Backend must issue JWT access tokens.
- Backend must issue refresh tokens.
- Refresh token rotation must be supported.
- Device/session metadata must be tracked.
- Deactivated users must not be allowed to log in.

Acceptance criteria:

- User can log in only with valid credentials.
- Refresh tokens rotate securely.
- User sessions show device and last activity information.

### 4.3 Forgot password

Requirements:

- Forgot password must use OTP email verification.
- OTP must have expiry.
- Reset password must happen only after OTP verification.
- Timer should be 2 minutes.
- User experience must not expose technical information.

Acceptance criteria:

- If account does not exist, backend should respond according to security policy while frontend gives professional guidance.
- User cannot reset password before OTP verification.
- Expired OTP cannot be used.
- Resend OTP follows timer/cooldown rules.

### 4.4 Sessions

Requirements:

- Multiple active sessions must be supported.
- User can log out from current device.
- User can log out from all devices.
- Active devices page must show useful session details.
- Login/logout notifications must not remain stuck on panel.

Acceptance criteria:

- Session list reflects active devices.
- Logout single device invalidates only that session.
- Logout all devices invalidates all refresh sessions.

### 4.5 Cookies and CSRF

Requirements:

- Refresh token must be stored in HttpOnly cookie where applicable.
- Cookie settings must be secure for production.
- CSRF protection must be applied to cookie-based authenticated flows.

## 5. Epic 2 — Role Management / RBAC

### 5.1 Dynamic permission system

Requirements:

- Permissions must be stored in the database.
- Roles must map to permissions through database relationships.
- Backend authorization checks must use dynamic permissions.
- Permission logic must not be scattered as hardcoded UI-only checks.

Required entities:

- Users
- OrganizationMembers
- Roles
- Permissions
- RolePermissions
- AuditLogs
- Sessions
- Organizations

Core permissions:

- CREATE
- UPDATE
- DELETE
- EXPORT
- UPLOAD
- AI_ACCESS
- BILLING
- USER_MANAGEMENT
- QUEUE_MANAGEMENT
- ANALYTICS
- PROMPT_MANAGEMENT
- API_ACCESS

### 5.2 Role rules

Requirements:

- One user can have one effective organization role at a time.
- Custom role names must be unique.
- Custom role names must reject symbols, emojis, and unsafe characters.
- Super Admin can create custom roles.
- Organization Admin can assign only allowed organization-level roles.
- Manager, Employee, and Viewer cannot assign roles.
- Super Admin cannot be assigned through frontend.

Acceptance criteria:

- Users cannot have duplicate or conflicting roles.
- Organization Admin cannot promote anyone to Super Admin.
- Role or permission changes create audit logs.

## 6. Epic 3 — Organization Module

### 6.1 Multi-tenant organizations

Requirements:

- Every organization must be isolated.
- Organization-scoped data must include `organization_id`.
- Queries must filter by current authorized organization.
- User cannot access users, documents, analytics, billing, settings, or AI data from another organization.

### 6.2 Create organization

Requirements:

- Only Super Admin can create organizations.
- Creation form should be modal-based and professional.
- Organization name and slug must be validated.
- Super Admin can assign an initial Organization Admin where policy allows.

### 6.3 Invite members

Requirements:

- Organization Admin can invite users to their organization.
- Super Admin can manage platform-level invitations where allowed.
- Invitation email must include invited name and email.
- Invitation must have status: pending, accepted, revoked, expired.
- Revoked or accepted invitations must not show misleading continue/sign-out flows.
- Same user cannot be added to multiple organizations under the current one-user-one-role/org policy.

Acceptance criteria:

- Invitation email works.
- Wrong invited email cannot accept invite.
- Expired/revoked/accepted invite shows clear user-facing message.

### 6.4 Switch organization

Current policy:

- Normal users should not switch between multiple organizations.
- Super Admin may view platform data across organizations.
- Organization selection should be available only where it is actually useful.

### 6.5 Settings, subscription, limits

Current policy:

- Payment/subscription UI is removed for now.
- Limits UI is removed for normal users.
- Backend can still keep safe internal defaults where required.

## 7. Epic 4 — User Management

### 7.1 Unified people directory

Requirements:

- Platform users and organization members should be merged into a single professional People screen.
- Member requests/invitations should be visible in the same workflow where practical.
- Table must show relevant columns such as person, type, organization, role, status, updated date, and actions.
- Search, filters, and pagination must be backend-driven.
- Filters should include organization and status.

### 7.2 User actions

Requirements:

- Create/invite user.
- Update user.
- Deactivate user.
- Delete user where allowed.
- Assign role.
- Search users.
- Filter users.
- Paginate users.
- Audit user changes.
- Rejection/revoke reason should be captured through modal where applicable.

Acceptance criteria:

- Super Admin can manage platform users according to policy.
- Organization Admin sees only own organization users.
- Organization Admin cannot see Super Admin records.
- Actions use icons with hover labels/tooltips.

## 8. Epic 5 — File Management

### 8.1 Supported files

Supported file types:

- PDF
- DOCX
- DOC
- PPT
- PPTX
- CSV
- XLSX
- TXT
- ZIP
- PNG
- JPEG
- HTML
- XML
- JSON

### 8.2 Upload

Requirements:

- Single upload.
- Multiple upload.
- Drag-and-drop upload.
- File validation before saving.
- Unsupported files must show clear notifications.
- Upload should create backend job/queue entry.
- Long-running processing may take up to 30 minutes.
- Frontend should show progress using SSE events.

Acceptance criteria:

- User can upload valid files.
- Unsupported files are rejected safely.
- Upload progress is visible.
- Interrupted network shows user-friendly notification.

### 8.3 Metadata extraction

Requirements:

- Extract filename, type, size, uploader, organization, created date, updated date, status, and version.
- Where possible, extract readable text for AI.
- Preview preparation must happen in backend.

### 8.4 Preview

Requirements:

- PDF/image/text preview must work where browser-supported.
- DOC/DOCX/PPT/PPTX preview should use backend conversion where LibreOffice is available.
- Technical errors must not be exposed to users.
- User-facing preview failure message must explain next step clearly.

### 8.5 File listing

Requirements:

- List documents with backend pagination.
- Search/filter/sort must be backend-driven.
- Long filenames must be trimmed with full value on hover.
- Columns must not overlap.
- Status and updated date must be visually separated.
- Actions should be compact icon buttons with tooltips.

### 8.6 File actions

Requirements:

- Preview.
- Download.
- Delete.
- Restore where applicable.
- Permanent purge for Super Admin/platform deleted files where allowed.
- Version history.

## 9. Epic 6 — RAG Module / AI Documents

### 9.1 Document preparation

Requirements:

- Uploaded documents must be extracted into readable text.
- Text must be chunked.
- Chunks must be converted into embeddings.
- Embeddings must be stored in Qdrant.
- Document metadata must be stored with vectors.
- Document delete must remove or invalidate related vectors.

User-facing terminology:

- Do not expose “RAG”, “chunking”, “embedding”, “vector database”, or “reindex” to normal users.
- Use user-friendly wording such as “Prepare files for AI”.

### 9.2 Retrieval pipeline

Required architecture:

1. User asks a question.
2. NestJS validates organization, role, and document access.
3. FastAPI receives only authorized document IDs.
4. Query embedding is generated.
5. Qdrant returns candidate chunks.
6. Candidates are filtered by relevance score.
7. Candidates are reranked.
8. Redundant chunks are reduced.
9. Final chunks are selected dynamically within context/token budget.
10. LLM receives only selected evidence.
11. Answer is returned with citations and sources.

Requirements:

- Do not send all retrieved chunks to the LLM.
- Do not hardcode final chunk count.
- Use configurable candidate count, relevance threshold, max final chunks, and context budget.
- Authorization remains in NestJS.
- FastAPI must not bypass organization/document access rules.

### 9.3 Search modes

Requirements:

- Semantic search.
- Hybrid search.
- Metadata filters.
- Organization/document namespace filtering.
- Dynamic evidence selection.

### 9.4 Citations and sources

Requirements:

- Answers must show citations through a clean citation button.
- Citations should include document name and location.
- Location should include page number where available.
- If page number is unavailable, show paragraph, line, slide, sheet, or section information.
- Old saved chats may retain old citation snapshots.

### 9.5 Ask AI UI

Requirements:

- Clean chat-style UI.
- Chat history panel.
- Selected files mode.
- All readable files mode.
- If all readable files are selected, file checklist should be hidden to avoid conflicting selection state.
- If user asks without selecting files in selected-file mode, show notification.
- Show simple loading state while AI is answering.
- Do not show technical backend operations to users.

### 9.6 Chat history

Requirements:

- Maintain chat history for user convenience.
- Do not send previous messages to LLM by default.
- Optional future improvement: send limited previous context only when user clearly refers to prior answer.

Deferred:

- Full conversation memory.
- Export chat.
- Streaming response, unless added as a future enhancement.

## 10. Epic 7 — Background Scheduler and Operations

### 10.1 Scheduled jobs

Requirements:

- Nightly cleanup.
- Expired sessions cleanup.
- Temporary file cleanup after 1 day.
- Retry failed jobs after 2 minutes where safe.
- RAG retry should not create infinite retry loops.

Deferred:

- Generate reports.
- Backup metadata automation.

### 10.2 Worker monitoring and logs

Requirements:

- Queue monitoring should be available through backend logs.
- Failed jobs should be logged with safe error details.
- System health should be visible through logs, not frontend UI for now.
- Logs must not expose secrets, tokens, cookies, passwords, or private request bodies.

## 11. Epic 8 — Knowledge Base

Current status: Future module.

Future requirements:

- Create knowledge base.
- Update knowledge base.
- Delete knowledge base.
- Folder structure.
- Collections.
- Tags.
- Categories.
- Sharing.
- Permissions.
- RAG filtering by knowledge base, collection, folder, or tag.

This module should reuse existing organization isolation, document permissions, and RAG authorization rules.

## 12. Security Requirements

### 12.1 API security

Requirements:

- Helmet.
- Rate limiting.
- Input validation.
- File validation.
- Magic number validation.
- CORS configured by environment.
- CSRF protection for cookie-based flows.
- SQL injection protection through Prisma parameterized queries.
- XSS protection through frontend escaping and backend sanitization.

### 12.2 Secret handling

Requirements:

- Secrets must be stored in environment variables.
- API keys must not be committed.
- Super Admin bootstrap credentials must come from environment/database setup.
- Gemini/RAG keys must be placed in backend/FastAPI environment configuration only.

### 12.3 Audit

Requirements:

- Role changes must create audit logs.
- Permission changes must create audit logs.
- User invite, revoke, accept, deactivate, delete, and organization changes must create audit logs.
- Audit logs must include actor, target user, organization, action, timestamp, and safe metadata.
- Audit metadata must redact Authorization headers, cookies, passwords, tokens, token hashes, password hashes, invite tokens, and other secrets.

## 13. Non-Functional Requirements

### 13.1 Performance

- Backend pagination must be used for large lists.
- Search and filtering must be backend-driven.
- RAG should retrieve candidate chunks, rerank, and send only selected chunks to LLM.
- Expensive models should be cached/persisted where possible.
- Long jobs should use queues/SSE rather than blocking UI.

### 13.2 Reliability

- Failed jobs should be retried safely.
- Long processing should show progress.
- Network disconnected state should notify user.
- UI should not get stuck with permanent notifications.

### 13.3 Usability

- UI language must be simple and non-technical.
- Avoid exposing internal terms like chunks, embeddings, Qdrant, RAG, reindex, or backend errors.
- Use clear empty states.
- Use concise notifications.
- Use responsive mobile layouts.
- Use icon-only actions with hover labels where appropriate.

### 13.4 Multi-tenancy

- Every organization resource must enforce `organization_id`.
- Super Admin access must be explicit and audited.
- Organization Admin must only see own organization data.
- Users cannot access another organization’s documents, members, settings, audit logs, or AI context.

## 14. Acceptance Summary

The system is acceptable when:

- Authentication is secure and invitation-based.
- One env/backend-controlled Super Admin exists.
- RBAC is dynamic and permission-driven.
- Organization data is isolated.
- Users, members, invites, and roles are manageable through professional UI.
- Documents can be uploaded, listed, previewed, downloaded, deleted, and versioned.
- AI can answer from authorized documents only.
- Citations show useful page/paragraph/section location where available.
- Background cleanup and retry jobs run safely.
- Logs and audit trails are secure and useful.
- Frontend avoids technical/internal terminology and feels production-ready.

