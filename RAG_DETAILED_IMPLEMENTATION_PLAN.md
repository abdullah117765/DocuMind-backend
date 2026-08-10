# RAG Module Detailed Implementation Plan

This document explains how the RAG module should work in this project, how it connects with the existing document module, and how access control must be enforced.

The key product rule is simple:

```txt
RAG can only answer from documents the current user is already allowed to access.
```

RAG must not create a new permission loophole. It must follow the same hierarchy-based document access that already exists in the NestJS document module.

---

## 1. Final RAG Rules

### 1.1 Organization scope

Every RAG query must run inside one organization only.

```txt
Allowed:
User selects Organization A -> asks from Organization A documents

Not allowed:
User asks across Organization A + Organization B together
```

Rules by role:

| Role | RAG organization scope |
|---|---|
| Super Admin | Must select one organization first, then ask only inside that organization |
| Organization Admin | Can ask only inside their own organization |
| Manager | Can ask only from hierarchy-accessible documents inside their organization |
| Employee | Can ask only from own/allowed documents inside their organization |
| Viewer | Can search/read only if role has required permissions |

### 1.2 File selection per question

Every time a user asks a question, the frontend should allow the user to choose the document scope:

```txt
Ask from:
1. All accessible documents
2. Selected files only
```

If selected files are provided, the backend must validate every selected file before sending anything to the RAG service.

### 1.3 Access source of truth

NestJS is the only source of truth for permissions.

FastAPI and Qdrant must not decide whether a user can access a document.

Correct flow:

```txt
Frontend
  -> NestJS checks session, role, permissions, organization, document hierarchy
  -> NestJS calculates allowed document IDs
  -> NestJS sends only allowed document IDs to FastAPI
  -> FastAPI searches Qdrant only within those document IDs
  -> Answer returns to NestJS
  -> NestJS returns response to frontend
```

### 1.4 Permissions

Recommended permission rules:

| Action | Required permission |
|---|---|
| RAG search only | `documents.read` |
| AI answer generation | `documents.read` + `ai.access` |
| Reindex documents | Organization Admin / document management permission |
| Platform RAG over one selected org | Super Admin only |

### 1.5 Manual access grants

For now, RAG should not introduce a new manual access system.

Current rule:

```txt
RAG access = hierarchy-based document access only
```

If the product later enables manual document sharing through `DocumentAccess`, RAG can be updated to respect that too. For v1, keep it hierarchy-based.

---

## 2. High-Level Architecture

```txt
React Frontend
  - RAG search page
  - Ask question box
  - Select files per question
  - Show answer and sources

NestJS API
  - Authenticates user
  - Enforces RBAC and hierarchy
  - Validates selected document IDs
  - Proxies safe RAG requests to FastAPI
  - Stores RAG status in Postgres
  - Writes audit logs

FastAPI RAG Service
  - Reads files from MinIO
  - Extracts text
  - Chunks text
  - Creates embeddings
  - Stores vectors in Qdrant
  - Searches vectors
  - Calls LLM for final answer

MinIO
  - Stores original uploaded files

Qdrant
  - Stores searchable vector chunks

LLM Provider
  - Gemini/OpenAI/etc. for answer generation
```

---

## 3. Existing System Integration

The project already has a document module with:

- `Document`
- `DocumentVersion`
- `DocumentAccess`
- Upload sessions
- MinIO storage keys
- Document hierarchy checks
- Organization-level isolation

Important current files:

```txt
nestjs-api/prisma/schema.prisma
nestjs-api/src/modules/documents/documents.service.ts
nestjs-api/src/modules/documents/documents.controller.ts
nestjs-api/src/modules/documents/document-storage.service.ts
fastapi-service/app/main.py
```

Important current logic to reuse:

```txt
buildOrganizationDocumentWhere()
canReadDocument()
canReachDocumentByHierarchy()
resolveVisibleDocumentCreatorUserIds()
resolveActorDocumentTier()
resolveUserDocumentTier()
```

The RAG module must reuse or wrap this logic. It must not duplicate access rules in FastAPI.

---

## 4. RAG Data Model

Add a DB table to track indexing state.

### 4.1 New Prisma enum

```prisma
enum DocumentRagIndexStatus {
  PENDING
  INDEXING
  INDEXED
  FAILED
  NO_CONTENT
}
```

### 4.2 New Prisma model

```prisma
model DocumentRagIndex {
  id              String                 @id @default(uuid()) @db.Uuid
  documentId      String                 @unique @map("document_id") @db.Uuid
  organizationId  String                 @map("organization_id") @db.Uuid
  versionId       String?                @map("version_id") @db.Uuid
  versionNumber   Int                    @map("version_number")
  status          DocumentRagIndexStatus @default(PENDING)
  chunksCount     Int                    @default(0) @map("chunks_count")
  embeddingModel  String                 @map("embedding_model") @db.VarChar(120)
  errorMessage    String?                @map("error_message") @db.Text
  indexedAt       DateTime?              @map("indexed_at")
  createdAt       DateTime               @default(now()) @map("created_at")
  updatedAt       DateTime               @updatedAt @map("updated_at")

  document        Document               @relation(fields: [documentId], references: [id], onDelete: Cascade)
  organization    Organization           @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId, status])
  @@index([documentId, versionNumber])
  @@map("document_rag_indexes")
}
```

Why this table is needed:

- The frontend can show `Ready for AI`, `Indexing`, `Failed`, or `No content`.
- Reindexing can be tracked.
- Selected-file RAG can warn if selected files are not indexed.
- Failed extraction can be retried.
- The system can avoid silently searching missing vectors.

---

## 5. Ingestion Flow

Ingestion means turning an uploaded document into searchable chunks.

### 5.1 Trigger points

RAG ingestion should be triggered when:

| Event | RAG action |
|---|---|
| Document committed after upload | Index latest version |
| New document version uploaded | Delete old vectors and index latest version |
| User deletes document | Remove vectors or mark as unavailable |
| Organization-level delete | Remove vectors from searchable scope |
| Platform purge | Delete vectors permanently |
| Organization deleted | Delete Qdrant org collection |

### 5.2 Recommended ingestion flow

```txt
User uploads file
  -> NestJS validates and stores original in MinIO
  -> NestJS commits document record
  -> NestJS creates/updates DocumentRagIndex as PENDING
  -> NestJS calls FastAPI /rag/ingest with HMAC signature
  -> FastAPI downloads file from MinIO
  -> FastAPI extracts text
  -> FastAPI chunks text
  -> FastAPI embeds chunks
  -> FastAPI stores chunks in Qdrant
  -> FastAPI returns status
  -> NestJS updates DocumentRagIndex
```

### 5.3 Async vs sync

Recommended v1 approach:

```txt
Upload should complete immediately.
RAG indexing should happen in background.
```

Why:

- Large PDFs/PPTs can take seconds.
- Legacy `.doc` and `.ppt` may need LibreOffice conversion.
- Upload UX should not freeze.
- Failed indexing should not mean failed upload.

If there is no queue yet, NestJS can call FastAPI after commit and record failures. Later, this can be moved to Redis/BullMQ.

---

## 6. Text Extraction

FastAPI should handle text extraction because Python has better document parsing tools.

Supported extraction strategy:

| File type | Extraction method |
|---|---|
| PDF | `pymupdf4llm` |
| DOCX | `python-docx` |
| DOC | LibreOffice headless -> DOCX -> `python-docx` |
| PPTX | `python-pptx` |
| PPT | LibreOffice headless -> PPTX -> `python-pptx` |
| XLSX | `openpyxl` |
| CSV | Python `csv` |
| TXT | Direct UTF-8 decode with fallback |
| HTML | Python HTML parser |
| XML | Python XML parser |
| JSON | Flatten JSON into readable text |
| PNG/JPEG/JPG | OCR fallback |
| ZIP | Already extracted by NestJS staging, RAG indexes extracted files individually |

### 6.1 LibreOffice location

LibreOffice should be installed where FastAPI runs.

Local development:

```txt
Developer machine or FastAPI local environment
```

Production:

```txt
Inside FastAPI Docker image
```

Example:

```dockerfile
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      libreoffice-core \
      libreoffice-writer \
      libreoffice-impress && \
    apt-get clean && rm -rf /var/lib/apt/lists/*
```

MinIO does not run LibreOffice. Frontend does not run LibreOffice. Only FastAPI runs conversion.

---

## 7. Chunking and Embeddings

### 7.1 Chunking

Use recursive text splitting.

Recommended defaults:

```txt
chunk_size = 500 characters/tokens depending implementation
chunk_overlap = 50
```

Chunk metadata:

```json
{
  "document_id": "doc-id",
  "organization_id": "org-id",
  "version_number": 2,
  "chunk_index": 4,
  "chunk_total": 31,
  "text": "Document excerpt...",
  "file_type": "pdf",
  "document_name": "Policy.pdf",
  "created_by_user_id": "user-id"
}
```

### 7.2 Embeddings

Recommended embedding model from existing plan:

```txt
BAAI/bge-small-en-v1.5
```

Dimensions:

```txt
384
```

Query embedding should use the BGE query prefix:

```txt
Represent this sentence: {query}
```

Document chunks should be embedded without the query prefix.

---

## 8. Qdrant Storage

### 8.1 Collection strategy

Use one Qdrant collection per organization.

```txt
org_{organizationId}
```

This gives organization-level isolation.

### 8.2 Document-level filtering is still required

Even with one collection per organization, users inside the same organization can have different document visibility.

Therefore every search/ask request must include allowed document IDs from NestJS.

Qdrant filter example:

```json
{
  "must": [
    {
      "key": "document_id",
      "match": {
        "any": ["doc-1", "doc-2"]
      }
    },
    {
      "key": "status",
      "match": {
        "value": "ACTIVE"
      }
    }
  ]
}
```

### 8.3 Idempotent indexing

Before indexing a document version:

```txt
Delete old vectors for document_id
Insert vectors for latest version
```

This prevents duplicate chunks.

---

## 9. Search Flow

Search returns chunks/results without generating an AI answer.

### 9.1 Frontend request

```json
{
  "query": "refund policy",
  "scope": "selected",
  "documentIds": ["doc-1", "doc-2"],
  "searchType": "hybrid",
  "topK": 8
}
```

### 9.2 NestJS processing

NestJS must:

1. Validate JWT/session.
2. Validate organization access.
3. Require `documents.read`.
4. Determine readable document IDs using existing hierarchy logic.
5. If `documentIds` are provided, validate each selected document.
6. Reject or hide unauthorized selected documents.
7. Send only allowed IDs to FastAPI.

Recommended behavior for unauthorized selected files:

```txt
Return 404 "Document not found."
```

This avoids leaking that a document exists.

### 9.3 FastAPI processing

FastAPI must:

1. Verify HMAC request from NestJS.
2. Reject direct frontend/browser access.
3. Embed query.
4. Search Qdrant inside the selected organization collection.
5. Apply document ID filter.
6. Return chunks and source metadata.

---

## 10. Ask AI Flow

Ask AI performs search first, then sends the best chunks to the LLM.

### 10.1 Frontend request

```json
{
  "query": "What is the leave policy?",
  "scope": "selected",
  "documentIds": ["doc-1", "doc-2"],
  "searchType": "hybrid",
  "topK": 5
}
```

### 10.2 NestJS requirements

NestJS must require:

```txt
documents.read
ai.access
```

### 10.3 LLM prompt rules

The prompt must say:

```txt
Answer only from the provided document excerpts.
If the answer is not present, say that the information was not found.
Always cite the source document.
Do not invent facts.
```

### 10.4 Response format

```json
{
  "answer": "The policy says employees may request leave through...",
  "sources": [
    {
      "documentId": "doc-1",
      "documentName": "Leave Policy.pdf",
      "chunkIndex": 3
    }
  ],
  "searchResults": [],
  "llmModel": "gemini-3.5-flash",
  "processingTimeMs": 1450
}
```

---

## 11. NestJS API Design

Add endpoints under the existing document/organization scope.

```txt
POST /api/organizations/:organizationId/documents/rag/search
POST /api/organizations/:organizationId/documents/rag/ask
GET  /api/organizations/:organizationId/documents/rag/status
POST /api/organizations/:organizationId/documents/rag/reindex
```

### 11.1 Search endpoint

Permission:

```txt
documents.read
```

Responsibilities:

- Validate organization.
- Apply hierarchy.
- Validate selected files.
- Proxy to FastAPI.
- Return search chunks.

### 11.2 Ask endpoint

Permission:

```txt
documents.read + ai.access
```

Responsibilities:

- Same as search.
- Proxy to FastAPI `/rag/ask`.
- Return answer and citations.

### 11.3 Status endpoint

Permission:

```txt
documents.read
```

Returns indexing status for readable documents.

### 11.4 Reindex endpoint

Permission:

```txt
Organization Admin or document management permission
```

Can reindex:

- One document
- Selected documents
- All accessible organization documents for admin scope

---

## 12. FastAPI API Design

FastAPI endpoints are internal only.

```txt
POST   /rag/ingest
POST   /rag/ingest-batch
POST   /rag/search
POST   /rag/ask
POST   /rag/reindex
DELETE /rag/documents/{document_id}
DELETE /rag/organizations/{organization_id}
GET    /rag/stats/{organization_id}
GET    /health
```

All `/rag/*` endpoints must require HMAC verification.

Frontend must never call FastAPI directly.

---

## 13. HMAC Security

NestJS signs requests to FastAPI.

Headers:

```txt
X-Service-Timestamp
X-Service-Signature
X-Service-Request-Id
```

Signature input:

```txt
timestamp + "." + method + "." + path + "." + body
```

FastAPI verifies:

- Signature is valid.
- Timestamp is recent.
- Request ID is not replayed if replay protection is implemented.

---

## 14. Frontend UX

Add a RAG page:

```txt
/documents/search
```

### 14.1 Page layout

Components:

- Organization context display
- Search/ask input
- Scope selector
- File selector
- Search type selector
- Answer panel
- Source citations
- Search results
- Indexing status warnings

### 14.2 Scope selector

```txt
Ask from:
[ All accessible documents v ]
[ Selected files only     v ]
```

When selected files mode is active:

```txt
Select files
Search documents...
[x] Policy.pdf
[x] Contract.docx
[ ] Report.pptx
```

The file selector should only list documents returned by the backend as accessible.

### 14.3 Handling not-indexed files

If selected files are not indexed:

```txt
Some selected files are still being prepared for AI.
You can ask from ready files now or wait until indexing finishes.
```

### 14.4 Source citations

Every AI answer must show sources:

```txt
Sources:
- Leave Policy.pdf
- Employee Handbook.docx
```

Clicking a source should open the document preview/detail.

---

## 15. Audit Logging

Audit these events:

| Event | Why |
|---|---|
| RAG search | Track document search activity |
| RAG ask | Track AI usage |
| RAG reindex | Admin/system action |
| RAG indexing failed | Operational visibility |
| RAG delete vectors | Data lifecycle tracking |

Do not store full prompts if they may contain sensitive data unless product policy allows it.

Recommended audit metadata:

```json
{
  "organizationId": "org-id",
  "actorUserId": "user-id",
  "scope": "selected",
  "documentCount": 3,
  "searchType": "hybrid",
  "topK": 5
}
```

Avoid storing:

- Full document chunks
- Secrets
- Access tokens
- Raw file content

---

## 16. Edge Cases

### 16.1 User selects unauthorized file

Return:

```txt
404 Document not found.
```

Do not reveal that the file exists.

### 16.2 User selects file from another organization

Return:

```txt
404 Document not found.
```

### 16.3 No selected files

If scope is `selected` and no document IDs are provided:

```txt
400 Select at least one document.
```

### 16.4 No indexed documents

Return a friendly message:

```txt
No searchable documents are ready yet.
```

### 16.5 LLM unavailable

For `/ask`, if LLM is unavailable:

```txt
Return search results with llmAvailable: false
```

### 16.6 Empty documents

Mark:

```txt
NO_CONTENT
```

### 16.7 Password-protected/corrupted files

Mark:

```txt
FAILED
```

Store a safe error message.

### 16.8 Deleted documents

Do not return chunks for:

- `PURGED`
- `SOFT_DELETED_BY_ORG`
- Documents not readable by current user

### 16.9 Document version update

Only latest version should be searchable unless version-specific RAG is intentionally added later.

---

## 17. Implementation Phases

### Phase 1: Database and configuration

- Add `DocumentRagIndexStatus` enum.
- Add `DocumentRagIndex` model.
- Add migration.
- Add env variables for FastAPI URL, HMAC secret, Qdrant, embedding model, LLM key.

### Phase 2: FastAPI infrastructure

- Add Qdrant service to Docker Compose.
- Add FastAPI Dockerfile with LibreOffice.
- Add Python dependencies.
- Add settings module.
- Add HMAC middleware.
- Add health checks.

### Phase 3: FastAPI RAG services

- Add MinIO reader.
- Add extraction service.
- Add chunking service.
- Add embedding service.
- Add Qdrant service.
- Add search service.
- Add LLM service.
- Add RAG router.

### Phase 4: NestJS RAG orchestration

- Add `RagOrchestratorService`.
- Sign FastAPI requests with HMAC.
- Trigger ingestion after commit/upload version.
- Trigger vector deletion after purge/org delete.
- Update `DocumentRagIndex` statuses.

### Phase 5: NestJS RAG access layer

- Add helper:

```txt
resolveReadableDocumentIdsForRag(organizationId, principal, selectedDocumentIds?)
```

This helper must use the existing hierarchy rules.

### Phase 6: NestJS RAG endpoints

- Add search endpoint.
- Add ask endpoint.
- Add status endpoint.
- Add reindex endpoint.
- Add DTO validation.
- Add audit logs.

### Phase 7: Frontend

- Add RAG page.
- Add ask/search input.
- Add selected-file picker per question.
- Add all-accessible vs selected-files scope.
- Add answer panel with citations.
- Add indexing status states.
- Add source document links.

### Phase 8: Tests

Add tests for:

- Employee cannot ask from manager/admin documents.
- Manager can ask from lower-tier users where hierarchy allows.
- Organization Admin cannot ask outside own organization.
- Super Admin must select one organization.
- Selected document IDs are validated.
- Unauthorized selected document returns 404.
- `documents.read` required for search.
- `ai.access` required for ask.
- Deleted/purged documents are excluded.
- FastAPI rejects unsigned requests.

---

## 18. Recommended Request DTOs

### 18.1 Search/ask DTO

```ts
class RagQueryDto {
  query: string;
  scope?: 'all' | 'selected';
  documentIds?: string[];
  searchType?: 'semantic' | 'keyword' | 'hybrid';
  topK?: number;
}
```

Validation:

```txt
query: required, trimmed, max length
scope: default all
documentIds: required only when scope = selected
topK: default 5, max 20
```

### 18.2 FastAPI internal request

```json
{
  "organization_id": "org-id",
  "query": "question",
  "allowed_document_ids": ["doc-1", "doc-2"],
  "search_type": "hybrid",
  "top_k": 5
}
```

Important:

```txt
FastAPI receives allowed_document_ids, not raw user-selected IDs.
```

---

## 19. Environment Variables

### NestJS

```txt
RAG_SERVICE_URL=http://localhost:8000
RAG_HMAC_SECRET=change-me
RAG_REQUEST_TIMEOUT_MS=30000
RAG_ENABLED=true
```

### FastAPI

```txt
HMAC_SECRET=change-me
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin123
MINIO_DOCUMENT_BUCKET=documents
QDRANT_HOST=qdrant
QDRANT_PORT=6333
EMBEDDING_MODEL=BAAI/bge-small-en-v1.5
EMBEDDING_DIMENSIONS=384
CHUNK_SIZE=500
CHUNK_OVERLAP=50
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash
```

---

## 20. Final Security Checklist

Before shipping RAG:

- [ ] Frontend cannot call FastAPI directly.
- [ ] FastAPI requires HMAC for every RAG endpoint.
- [ ] NestJS validates organization scope.
- [ ] NestJS validates selected document IDs.
- [ ] NestJS enforces hierarchy-based document access.
- [ ] Search requires `documents.read`.
- [ ] Ask requires `documents.read` and `ai.access`.
- [ ] Qdrant search is filtered by allowed document IDs.
- [ ] Deleted/purged documents are excluded.
- [ ] Audit logs do not store secrets or raw chunks.
- [ ] Super Admin can query only one selected organization at a time.
- [ ] Organization Admin cannot query another organization.

---

## 21. Final Build Order

Recommended implementation order:

1. Database migration for RAG index status.
2. FastAPI settings, Dockerfile, and Qdrant setup.
3. FastAPI extraction/chunking/embedding/Qdrant services.
4. FastAPI `/rag/ingest`, `/rag/search`, `/rag/ask`.
5. NestJS HMAC RAG orchestrator.
6. NestJS indexing triggers after document commit/version/delete.
7. NestJS hierarchy-based RAG access helper.
8. NestJS search/ask/status/reindex endpoints.
9. Frontend RAG page with selected-file picker per question.
10. Audit logs and tests.

This order keeps the security boundary correct from the start and prevents RAG from bypassing existing document permissions.

