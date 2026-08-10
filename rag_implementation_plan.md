# Epic 5: RAG Module — Implementation Plan

---

## Architecture Overview

```
EXISTING (no changes)                      NEW (RAG pipeline)
─────────────────────                      ────────────────────

  React Frontend                           React Frontend
  (Upload, Preview) ✅                     (Search, Ask AI) 🆕
       │                                        │
       ▼                                        ▼
  NestJS API                               NestJS API
  (Stage → Commit → MinIO) ✅              (Orchestrator: proxies to FastAPI) 🆕
       │                                        │
       ▼                                        │ HMAC-signed HTTP
  MinIO ✅                                      ▼
  (Document storage)                       FastAPI Service 🆕
       │                                   (RAG Engine)
       │                                        │
       │  ┌─────────────────────────────────────┘
       │  │
       ▼  ▼
  FastAPI reads file from MinIO
       │
       ▼
  ┌─────────────┐   ┌──────────┐   ┌───────────┐   ┌────────┐
  │ Extract Text│ → │ Chunk    │ → │ Embed     │ → │ Store  │
  │ (pymupdf4llm│   │ (lang-   │   │ (BGE-small│   │(Qdrant)│
  │  python-docx│   │  chain)  │   │  en-v1.5) │   │        │
  │  openpyxl   │   │          │   │           │   │        │
  │  OCR, etc.) │   │          │   │           │   │        │
  └─────────────┘   └──────────┘   └───────────┘   └────────┘
```

### Inter-Service Flow

1. **User uploads document** → NestJS stages + commits to MinIO (existing, untouched)
2. **After commit** → NestJS sends HMAC-signed `POST /rag/ingest` to FastAPI with storage info
3. **FastAPI** reads file from MinIO → extracts text → chunks → embeds → stores in Qdrant
4. **User searches** → NestJS proxies `POST /rag/search` to FastAPI → FastAPI queries Qdrant → returns results
5. **User asks AI** → NestJS proxies `POST /rag/ask` to FastAPI → FastAPI queries Qdrant → feeds chunks to Gemini → returns answer

---

## Technology Stack

| Component | Choice | Rationale |
|---|---|---|
| **Vector Database** | Qdrant (self-hosted, Docker) | Free, native hybrid search, rich payload filtering |
| **Embedding Model** | `BAAI/bge-small-en-v1.5` (384 dims) | +10 points over MiniLM on retrieval benchmarks, runs on CPU |
| **LLM** | Gemini 2.0 Flash | Best free tier (1M tokens/day, 15 RPM), fast (~1s), 1M context |
| **PDF Extraction** | `pymupdf4llm` | Handles multi-column layouts, outputs clean Markdown |
| **Office Docs** | `python-docx`, `python-pptx`, `openpyxl` | Native parsing of DOCX/PPTX/XLSX |
| **Legacy Office** | LibreOffice headless | Converts `.doc`→`.docx`, `.ppt`→`.pptx` |
| **Images OCR** | Tesseract via `pymupdf` | Built-in OCR for PNG/JPEG and scanned PDFs |
| **HTML/XML** | Python stdlib (`html.parser`, `xml.etree`) | Zero dependencies, no BeautifulSoup needed |
| **Chunking** | `langchain-text-splitters` | Recursive splitting with token-aware boundaries |

---

## Phase 1: Infrastructure Setup

### 1A. Qdrant in Docker

#### [MODIFY] [docker-compose.yml](file:///c:/Users/Mubashir%20Nawaz/Documents/GitHub/Back-End/docker-compose.yml)

Add:
```yaml
qdrant:
  image: qdrant/qdrant:v1.14.0
  container_name: ai-doc-intel-qdrant
  restart: unless-stopped
  ports:
    - "127.0.0.1:${QDRANT_HTTP_PORT:-6333}:6333"
    - "127.0.0.1:${QDRANT_GRPC_PORT:-6334}:6334"
  volumes:
    - qdrant_data:/qdrant/storage
```

### 1B. Python Dependencies

#### [MODIFY] [requirements.txt](file:///c:/Users/Mubashir%20Nawaz/Documents/GitHub/Back-End/fastapi-service/requirements.txt)

```txt
# Existing
fastapi>=0.115,<1.0
pydantic-settings>=2.7,<3.0
uvicorn[standard]>=0.34,<1.0

# Text Extraction
pymupdf>=1.25,<2.0               # PDF text + image OCR
pymupdf4llm>=0.0.17              # Column-aware PDF → Markdown extraction
python-docx>=1.1,<2.0            # DOCX parsing
python-pptx>=1.0,<2.0            # PPTX parsing
openpyxl>=3.1,<4.0               # XLSX parsing

# RAG Pipeline
sentence-transformers>=3.0,<4.0  # Embedding model loader (BGE-small)
qdrant-client>=1.14,<2.0         # Vector DB client
langchain-text-splitters>=0.3,<1.0  # Text chunking

# Infrastructure
minio>=7.2,<8.0                  # Read files from MinIO
google-genai>=1.0,<2.0           # Gemini LLM
```

### 1C. LibreOffice in FastAPI Dockerfile

#### [NEW] `fastapi-service/Dockerfile`

```dockerfile
FROM python:3.12-slim

# LibreOffice headless for .doc and .ppt conversion
RUN apt-get update && \
    apt-get install -y --no-install-recommends libreoffice-core libreoffice-writer libreoffice-impress && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Add to `docker-compose.yml`:
```yaml
fastapi:
  build: ./fastapi-service
  container_name: ai-doc-intel-fastapi
  restart: unless-stopped
  ports:
    - "127.0.0.1:${FASTAPI_PORT:-8000}:8000"
  env_file:
    - ./fastapi-service/.env
  depends_on:
    - qdrant
    - minio
```

### 1D. Configuration

#### [NEW] `fastapi-service/app/config/settings.py`

```python
class Settings(BaseSettings):
    # Existing
    HMAC_SECRET: str
    DATABASE_URL: str

    # MinIO (read-only, to fetch documents for processing)
    MINIO_ENDPOINT: str = "minio:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin123"
    MINIO_USE_SSL: bool = False
    MINIO_DOCUMENT_BUCKET: str = "documents"

    # Qdrant
    QDRANT_HOST: str = "qdrant"
    QDRANT_PORT: int = 6333

    # Embedding
    EMBEDDING_MODEL: str = "BAAI/bge-small-en-v1.5"
    EMBEDDING_DIMENSIONS: int = 384
    EMBEDDING_QUERY_PREFIX: str = "Represent this sentence: "

    # Chunking
    CHUNK_SIZE: int = 500
    CHUNK_OVERLAP: int = 50

    # Search
    DEFAULT_TOP_K: int = 5
    MAX_TOP_K: int = 20

    # LLM
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.5-flash"
```

#### [MODIFY] `fastapi-service/.env.example`
Add all above variables.

---

## Phase 2: Text Extraction Service

#### [NEW] `app/services/extraction_service.py`

This service reads a file from MinIO and converts it to plain text. Every format goes through a format-specific extractor, but they all output the same thing: **a string of text**.

### How Each Format Is Extracted

#### PDF → `pymupdf4llm`
```python
import pymupdf4llm

def extract_pdf(file_bytes: bytes) -> str:
    md_text = pymupdf4llm.to_markdown(file_bytes)
    return md_text
```
- Handles multi-column layouts by detecting text block positions
- Outputs Markdown (headings, tables preserved)
- Falls back to OCR for scanned pages automatically

#### DOCX → `python-docx`
```python
from docx import Document

def extract_docx(file_bytes: bytes) -> str:
    doc = Document(io.BytesIO(file_bytes))
    paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
    tables = []
    for table in doc.tables:
        for row in table.rows:
            tables.append(" | ".join(cell.text for cell in row.cells))
    return "\n".join(paragraphs + tables)
```

#### PPTX → `python-pptx`
```python
from pptx import Presentation

def extract_pptx(file_bytes: bytes) -> str:
    prs = Presentation(io.BytesIO(file_bytes))
    slides_text = []
    for i, slide in enumerate(prs.slides):
        slide_content = [f"--- Slide {i+1} ---"]
        for shape in slide.shapes:
            if shape.has_text_frame:
                slide_content.append(shape.text_frame.text)
        slides_text.append("\n".join(slide_content))
    return "\n\n".join(slides_text)
```

#### XLSX → `openpyxl`
```python
from openpyxl import load_workbook

def extract_xlsx(file_bytes: bytes) -> str:
    wb = load_workbook(io.BytesIO(file_bytes), read_only=True)
    output = []
    for sheet in wb.worksheets:
        output.append(f"--- Sheet: {sheet.title} ---")
        headers = []
        for i, row in enumerate(sheet.iter_rows(values_only=True)):
            if i == 0:
                headers = [str(c) if c else "" for c in row]
            else:
                row_text = ", ".join(
                    f"{headers[j]}={str(v)}" for j, v in enumerate(row) if v
                )
                output.append(row_text)
    return "\n".join(output)
```

#### CSV → Python stdlib
```python
import csv

def extract_csv(file_bytes: bytes) -> str:
    reader = csv.DictReader(io.StringIO(file_bytes.decode("utf-8")))
    rows = []
    for row in reader:
        rows.append(", ".join(f"{k}={v}" for k, v in row.items() if v))
    return "\n".join(rows)
```

#### DOC / PPT → LibreOffice → then DOCX/PPTX extraction
```python
import subprocess, tempfile

def convert_legacy(file_bytes: bytes, extension: str) -> bytes:
    with tempfile.NamedTemporaryFile(suffix=f".{extension}", delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    subprocess.run([
        "libreoffice", "--headless", "--convert-to",
        "docx" if extension == "doc" else "pptx",
        "--outdir", tempfile.gettempdir(), tmp_path
    ], check=True, timeout=30)

    converted_ext = "docx" if extension == "doc" else "pptx"
    converted_path = tmp_path.replace(f".{extension}", f".{converted_ext}")
    with open(converted_path, "rb") as f:
        return f.read()

# .doc → convert to .docx → extract_docx()
# .ppt → convert to .pptx → extract_pptx()
```

#### PNG / JPEG / JPG → OCR via pymupdf
```python
import fitz  # pymupdf

def extract_image(file_bytes: bytes) -> str:
    doc = fitz.open(stream=file_bytes, filetype="png")  # or "jpeg"
    page = doc[0]
    text = page.get_text("text")
    if not text.strip():
        # OCR fallback
        tp = page.get_textpage_ocr(language="eng")
        text = page.get_text("text", textpage=tp)
    return text
```

#### HTML → Python stdlib
```python
from html.parser import HTMLParser

class _TextExtractor(HTMLParser):
    SKIP_TAGS = {"script", "style", "nav", "footer", "header"}

    def __init__(self):
        super().__init__()
        self.text = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP_TAGS:
            self._skip_depth += 1

    def handle_endtag(self, tag):
        if tag in self.SKIP_TAGS:
            self._skip_depth -= 1

    def handle_data(self, data):
        if self._skip_depth == 0 and data.strip():
            self.text.append(data.strip())

def extract_html(file_bytes: bytes) -> str:
    parser = _TextExtractor()
    parser.feed(file_bytes.decode("utf-8", errors="replace"))
    return "\n".join(parser.text)
```

#### XML → Python stdlib
```python
import xml.etree.ElementTree as ET

def extract_xml(file_bytes: bytes) -> str:
    root = ET.fromstring(file_bytes.decode("utf-8", errors="replace"))
    return " ".join(root.itertext())
```

#### JSON → Python stdlib
```python
import json

def extract_json(file_bytes: bytes) -> str:
    data = json.loads(file_bytes.decode("utf-8"))

    def flatten(obj, prefix=""):
        lines = []
        if isinstance(obj, dict):
            for k, v in obj.items():
                lines.extend(flatten(v, f"{prefix}{k}: " if not prefix else f"{prefix}.{k}: "))
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                lines.extend(flatten(item, f"{prefix}[{i}]: "))
        else:
            lines.append(f"{prefix}{obj}")
        return lines

    return "\n".join(flatten(data))
```

#### TXT → Direct read
```python
def extract_txt(file_bytes: bytes) -> str:
    return file_bytes.decode("utf-8", errors="replace")
```

#### ZIP → Already handled
NestJS extracts ZIP into individual files during staging. RAG never sees ZIPs.

### Dispatcher

```python
EXTRACTORS = {
    "pdf":  extract_pdf,
    "docx": extract_docx,
    "pptx": extract_pptx,
    "xlsx": extract_xlsx,
    "csv":  extract_csv,
    "txt":  extract_txt,
    "html": extract_html,
    "xml":  extract_xml,
    "json": extract_json,
    "png":  extract_image,
    "jpeg": extract_image,
    "jpg":  extract_image,
    "doc":  lambda b: extract_docx(convert_legacy(b, "doc")),
    "ppt":  lambda b: extract_pptx(convert_legacy(b, "ppt")),
}

def extract_text(file_bytes: bytes, extension: str) -> str:
    extractor = EXTRACTORS.get(extension.lower())
    if not extractor:
        raise ValueError(f"Unsupported file type: .{extension}")
    return extractor(file_bytes)
```

**Edge Cases:**
- ⚡ **Password-protected files:** Catch exception → return `EXTRACTION_FAILED` status
- ⚡ **Empty documents:** Return empty string → skip chunking/embedding → mark as `NO_CONTENT`
- ⚡ **Encoding errors:** All decoders use `errors="replace"` to prevent crashes
- ⚡ **Very large text output (>500K chars):** Truncate with warning flag
- ⚡ **LibreOffice timeout:** 30-second timeout on conversion subprocess
- ⚡ **Corrupted files:** Catch all exceptions → return `EXTRACTION_FAILED`

---

## Phase 3: Chunking Service

#### [NEW] `app/services/chunking_service.py`

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter

class ChunkingService:
    def __init__(self, chunk_size=500, chunk_overlap=50):
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            separators=["\n\n", "\n", ". ", " ", ""],
            length_function=len,
        )

    def chunk(self, text: str) -> list[dict]:
        if not text.strip():
            return []

        chunks = self.splitter.split_text(text)

        return [
            {
                "text": chunk,
                "index": i,
                "char_start": text.find(chunk),
                "char_end": text.find(chunk) + len(chunk),
            }
            for i, chunk in enumerate(chunks)
        ]
```

**How splitting works:**
```
"Paragraph 1 about refunds.\n\nParagraph 2 about returns.\n\nParagraph 3..."
                                    ↓
Tries to split at "\n\n" first (paragraph breaks)
If chunk still too big → splits at "\n" (line breaks)
If still too big → splits at ". " (sentences)
If still too big → splits at " " (words)
Last resort → splits at "" (characters)
```

**Overlap ensures continuity:**
```
Chunk 1: "...refund policy allows returns within 30 days. Items must be"
Chunk 2: "Items must be in original packaging. Digital products are..."
          ^^^^^^^^^^^^^^^^
          overlap (appears in both chunks)
```

**Edge Cases:**
- ⚡ **Text shorter than chunk_size:** Returns single chunk
- ⚡ **Empty text:** Returns empty list (no chunks to embed)

---

## Phase 4: Embedding Service

#### [NEW] `app/services/embedding_service.py`

```python
from sentence_transformers import SentenceTransformer

class EmbeddingService:
    def __init__(self, model_name="BAAI/bge-small-en-v1.5"):
        # Loaded ONCE at startup, stays in memory (~130MB)
        self.model = SentenceTransformer(model_name)
        self.query_prefix = "Represent this sentence: "

    def embed_chunks(self, texts: list[str]) -> list[list[float]]:
        """Embed document chunks (no prefix)."""
        return self.model.encode(texts, batch_size=32, normalize_embeddings=True).tolist()

    def embed_query(self, query: str) -> list[float]:
        """Embed a search query (WITH prefix for BGE models)."""
        return self.model.encode(
            self.query_prefix + query, normalize_embeddings=True
        ).tolist()
```

**Why the query prefix?**
BGE models are trained with asymmetric encoding — queries and documents are treated differently. Adding `"Represent this sentence: "` to queries improves retrieval accuracy by ~3-5% on benchmarks. Document chunks are embedded without any prefix.

**Performance:**
- Model loads once at FastAPI startup (~2-3 seconds, ~130MB RAM)
- Batch of 32 chunks: ~65ms on CPU
- Single query: ~5ms

---

## Phase 5: Qdrant Vector Storage

#### [NEW] `app/services/qdrant_service.py`

### Namespace Strategy (Multi-Tenant Isolation)

One Qdrant collection per organization:
```
Qdrant
├── Collection: "org_acme-corp-uuid"       ← Acme Corp's chunks
├── Collection: "org_globex-uuid"          ← Globex's chunks
└── Collection: "org_initech-uuid"         ← Initech's chunks
```

Users from Acme Corp can **never** search Globex's data — isolation is enforced at the collection level.

### Collection Configuration

Each collection is created with:
- **Vector:** 384 dimensions, Cosine distance
- **HNSW index:** m=16, ef_construct=100 (fast approximate search)
- **Full-text index** on `text` field (enables BM25 keyword search for hybrid)
- **Payload indexes** on `document_id`, `collection_id`, `version_number` (fast filtering)

### Payload Per Vector Point

```json
{
  "document_id": "doc-456",
  "document_name": "Refund Policy",
  "collection_id": "col-789",
  "collection_slug": "hr-policies",
  "version_number": 3,
  "file_type": "pdf",
  "chunk_index": 7,
  "chunk_total": 42,
  "text": "Items can be returned within 30 days of purchase...",
  "uploaded_by_id": "user-123",
  "created_at": "2025-08-07T10:00:00Z"
}
```

### Key Operations

| Operation | When | What Happens in Qdrant |
|---|---|---|
| **Ingest** | Document committed | Create collection if needed → upsert points |
| **Delete document** | User deletes doc | Delete all points where `document_id` matches |
| **New version** | User uploads v2 | Delete points for old version → insert new ones |
| **Delete org** | Org is deleted | Delete entire collection `org_{orgId}` |
| **Reindex** | Admin triggers | Delete all points → re-insert with new embeddings |

**Edge Cases:**
- ⚡ **Collection doesn't exist:** Auto-create on first ingest (idempotent)
- ⚡ **Duplicate ingest (same doc, same version):** Delete existing points first, then insert (idempotent)
- ⚡ **Concurrent ingests:** Qdrant handles concurrent writes safely
- ⚡ **Org deleted:** Drop entire collection → all data gone instantly

---

## Phase 6: Search Service

#### [NEW] `app/services/search_service.py`

### Three Search Modes

#### Semantic Search (meaning-based)
```
Query: "How do I return a product?"
  → Embed with BGE (+ query prefix)
  → Qdrant nearest neighbor search (cosine similarity)
  → Finds chunks about "returns", "refunds", "30-day policy"
     even without those exact words in the query
```

#### Keyword Search (exact match, BM25)
```
Query: "SKU-4821"
  → Qdrant full-text search on "text" payload field
  → Finds chunks containing exactly "SKU-4821"
```

#### Hybrid Search (both combined)
```
Query: "SKU-4821 return policy"
  → Run BOTH semantic + keyword search in parallel
  → Merge via Reciprocal Rank Fusion (RRF):
       score = Σ 1/(k + rank_in_list) for each list the chunk appears in
  → Chunks appearing in BOTH results get boosted
  → Return top K merged results
```

### Metadata Filters

Applied **before** vector search — Qdrant only searches within the filtered subset:
```json
{
  "collection_id": "col-789",
  "file_type": "pdf",
  "version_number": 3
}
```

Use cases:
- "Search only in HR Policies collection"
- "Search only PDFs"
- "Search only latest versions"

### Top K

Configurable per request. Default: 5. Maximum: 20.

**Edge Cases:**
- ⚡ **No results:** Return empty array with message
- ⚡ **Top K > available chunks:** Return all available
- ⚡ **Query too long (>512 tokens):** Truncate to model max input
- ⚡ **Empty query:** Return 400 error
- ⚡ **Special characters in query:** Safe — Qdrant handles them

---

## Phase 7: LLM Answer Generation

#### [NEW] `app/services/llm_service.py`

Takes search results + user question → generates a natural language answer using Gemini.

### Prompt Template

```
You are an AI assistant for {organization_name}. Answer the user's
question based ONLY on the provided document excerpts below.

Rules:
- If the answer is not found in the excerpts, say "I couldn't find
  this information in the available documents."
- Always cite which document the information comes from.
- Do not make up information that isn't in the excerpts.
- Be concise and direct.

--- DOCUMENT EXCERPTS ---
[1] From "Refund Policy" (chunk 7):
Items can be returned within 30 days of purchase...

[2] From "Refund Policy" (chunk 12):
Refunds are processed within 5-7 business days...

[3] From "Digital Products FAQ" (chunk 2):
Digital products are non-refundable...
--- END EXCERPTS ---

User question: {query}
```

### Response Format

```json
{
  "answer": "Based on the documents, items can be returned within 30 days. Refunds are processed in 5-7 business days. Digital products are non-refundable.",
  "sources": [
    { "document_id": "doc-456", "document_name": "Refund Policy", "chunk_index": 7 },
    { "document_id": "doc-456", "document_name": "Refund Policy", "chunk_index": 12 },
    { "document_id": "doc-789", "document_name": "Digital Products FAQ", "chunk_index": 2 }
  ],
  "llm_model": "gemini-3.5-flash"
}
```

**Edge Cases:**
- ⚡ **No relevant chunks found:** Skip LLM, return "No relevant documents found"
- ⚡ **Gemini rate limit (15 RPM free):** Return search results without answer, flag `llm_available: false`
- ⚡ **Gemini API key not set:** Disable `/ask` endpoint, only `/search` works
- ⚡ **LLM hallucination guard:** Prompt explicitly instructs "ONLY use provided excerpts"

---

## Phase 8: API Endpoints

### FastAPI Routes

#### [NEW] `app/routers/rag_router.py`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/rag/ingest` | HMAC | Extract → chunk → embed → store |
| POST | `/rag/ingest-batch` | HMAC | Process multiple documents |
| DELETE | `/rag/documents/{document_id}` | HMAC | Delete all vectors for a document |
| DELETE | `/rag/organizations/{org_id}` | HMAC | Delete entire org collection |
| POST | `/rag/search` | HMAC | Semantic / keyword / hybrid search |
| POST | `/rag/ask` | HMAC | Search + Gemini answer generation |
| POST | `/rag/reindex` | HMAC | Re-process selected documents |
| GET | `/rag/stats/{org_id}` | HMAC | Total chunks, documents indexed |
| GET | `/health` | Public | Health check (existing) |

### Request / Response Examples

**`POST /rag/ingest`** (called by NestJS after document commit)
```json
// Request
{
  "document_id": "doc-456",
  "organization_id": "org-123",
  "collection_id": "col-789",
  "version_number": 1,
  "document_name": "Refund Policy",
  "file_type": "pdf",
  "storage_bucket": "documents",
  "storage_key": "organizations/org-123/documents/doc-456/versions/v1-refund-policy.pdf",
  "uploaded_by_id": "user-001"
}

// Response
{
  "status": "success",
  "document_id": "doc-456",
  "chunks_created": 42,
  "processing_time_ms": 1850
}
```

**`POST /rag/search`**
```json
// Request
{
  "organization_id": "org-123",
  "query": "What is the refund policy?",
  "search_type": "hybrid",
  "top_k": 5,
  "filters": {
    "collection_id": "col-789",
    "file_type": "pdf"
  }
}

// Response
{
  "results": [
    {
      "score": 0.92,
      "text": "Items can be returned within 30 days of purchase...",
      "document_id": "doc-456",
      "document_name": "Refund Policy",
      "collection_slug": "hr-policies",
      "chunk_index": 7,
      "version_number": 1
    }
  ],
  "total_results": 5,
  "search_type": "hybrid",
  "processing_time_ms": 85
}
```

**`POST /rag/ask`**
```json
// Request
{
  "organization_id": "org-123",
  "query": "What is the refund policy?",
  "search_type": "hybrid",
  "top_k": 5
}

// Response
{
  "answer": "Based on the documents, items can be returned within 30 days...",
  "sources": [
    { "document_id": "doc-456", "document_name": "Refund Policy", "chunk_index": 7 }
  ],
  "search_results": [ ... ],
  "llm_model": "gemini-3.5-flash",
  "processing_time_ms": 1450
}
```

### NestJS Orchestration

#### [NEW] `nestjs-api/src/modules/documents/rag-orchestrator.service.ts`

Bridges NestJS → FastAPI. Signs all requests with HMAC.

| Trigger | Action |
|---|---|
| After `commitUploadSession` | Call `POST /rag/ingest` for each committed document |
| After `deleteDocument` | Call `DELETE /rag/documents/{id}` |
| After `uploadVersion` | Call `POST /rag/ingest` with new version number |
| After org deletion | Call `DELETE /rag/organizations/{orgId}` |

#### [MODIFY] [documents.controller.ts](file:///c:/Users/Mubashir%20Nawaz/Documents/GitHub/Back-End/nestjs-api/src/modules/documents/documents.controller.ts)

Add proxy endpoints:

| Method | Endpoint | Permission | Description |
|---|---|---|---|
| POST | `/organizations/:orgId/documents/search` | `documents.read` | Proxy to FastAPI `/rag/search` |
| POST | `/organizations/:orgId/documents/ask` | `documents.read` + `ai.access` | Proxy to FastAPI `/rag/ask` |
| POST | `/organizations/:orgId/documents/reindex` | Org Admin only | Trigger reindex |
| GET | `/organizations/:orgId/documents/rag-stats` | `documents.read` | Indexing stats |

---

## Phase 9: Document Versioning in RAG

Already handled by existing `DocumentVersion` model. The flow:

```
Version 1 uploaded → 42 chunks stored with version_number=1
Version 2 uploaded → FastAPI:
  1. Deletes all points where document_id="doc-456" AND version_number < 2
  2. Extracts text from new version
  3. Chunks → embeds → stores with version_number=2
  4. Searches now only return version 2 results
```

No additional models or schema changes needed.

---

## Phase 10: Reindex

#### [NEW] `app/services/reindex_service.py`

**When to reindex:**
- Admin changes chunk_size / chunk_overlap settings
- Switching to a different embedding model in the future
- Documents were partially processed due to errors

**How it works:**
1. Admin selects scope: all docs, specific collection, or specific documents
2. NestJS sends `POST /rag/reindex` with document IDs
3. FastAPI for each document:
   - Delete existing vectors from Qdrant
   - Re-read file from MinIO
   - Re-extract → re-chunk → re-embed → re-store
4. Returns progress summary

**Edge Cases:**
- ⚡ **Source file deleted from MinIO:** Skip, mark as `REINDEX_FAILED`
- ⚡ **Users searching during reindex:** Qdrant handles concurrent reads/writes — searches work against existing data until replaced

---

## Phase 11: Frontend — Search & AI Chat UI

### [NEW] `src/features/documents/pages/DocumentSearch.jsx`

**Search Bar:**
- Large input: "Ask anything about your documents..."
- Search type toggle: Semantic | Keyword | Hybrid (default: Hybrid)
- `Ctrl+K` / `Cmd+K` keyboard shortcut to focus from anywhere

**Filter Sidebar:**
- Collection dropdown
- File type checkboxes (PDF, DOCX, etc.)
- Date range picker

**Results Panel:**
- Relevance score badge (92%, 87%)
- Document name (clickable → opens DocumentDetail)
- Collection badge
- Chunk text with query terms highlighted
- "View in document" link

**AI Answer Panel (when using `/ask`):**
- Collapsible panel above results
- Generated answer with typing animation
- Source citations as clickable document links
- "AI-generated from your documents" disclaimer

### [NEW] `src/features/documents/components/SearchBar.jsx`
- Reusable component also placed in the authenticated layout topbar
- `Ctrl+K` opens a command palette style overlay

### [MODIFY] `documentsApi.js`
Add: `searchDocuments(orgId, params)`, `askDocuments(orgId, params)`, `reindexDocuments(orgId, params)`, `getRAGStats(orgId)`

### [MODIFY] `AppRoutes.jsx`
Add: `/documents/search` → DocumentSearch

### [MODIFY] `AuthenticatedLayout.jsx`
Add: "Search" sidebar link under Documents section + global `Ctrl+K` handler

---

## Complete File Summary

### New Files (14)

| File | Location | Purpose |
|---|---|---|
| `Dockerfile` | `fastapi-service/` | FastAPI image with LibreOffice |
| `settings.py` | FastAPI `app/config/` | All RAG configuration |
| `extraction_service.py` | FastAPI `app/services/` | 14 file type extractors |
| `chunking_service.py` | FastAPI `app/services/` | Text splitting |
| `embedding_service.py` | FastAPI `app/services/` | BGE-small-en-v1.5 vectors |
| `qdrant_service.py` | FastAPI `app/services/` | Vector DB operations |
| `search_service.py` | FastAPI `app/services/` | Semantic + keyword + hybrid |
| `llm_service.py` | FastAPI `app/services/` | Gemini answer generation |
| `reindex_service.py` | FastAPI `app/services/` | Re-processing pipeline |
| `minio_client.py` | FastAPI `app/services/` | Read files from MinIO |
| `rag_router.py` | FastAPI `app/routers/` | All RAG API endpoints |
| `hmac_middleware.py` | FastAPI `app/middleware/` | Request verification |
| `rag-orchestrator.service.ts` | NestJS `modules/documents/` | NestJS → FastAPI bridge |
| `DocumentSearch.jsx` | Frontend `features/documents/pages/` | Search + AI chat UI |

### Modified Files (6)

| File | Change |
|---|---|
| `docker-compose.yml` | Add Qdrant + FastAPI services |
| `requirements.txt` | Add RAG Python packages |
| `.env.example` (both) | Add Qdrant, Gemini, embedding config |
| `documents.controller.ts` | Add search/ask/reindex/stats proxy endpoints |
| `documents.service.ts` | Call RAG orchestrator after commit/delete/version |
| `documentsApi.js` (frontend) | Add search/ask/reindex API calls |
| `AppRoutes.jsx` | Add `/documents/search` route |
| `AuthenticatedLayout.jsx` | Add search sidebar link + Ctrl+K |

---

## Latency Breakdown

| Step | Time | Notes |
|---|---|---|
| **Ingest (per document)** | | |
| Read from MinIO | ~50ms | Network call |
| Extract text (PDF) | ~200-500ms | Depends on page count |
| Chunk text | ~10ms | Pure CPU |
| Embed 40 chunks | ~80ms | BGE-small on CPU, batch of 32 |
| Store in Qdrant | ~30ms | Batch upsert |
| **Total ingest** | **~400-700ms** | Per document |
| | | |
| **Search (per query)** | | |
| Embed query | ~5ms | Single embedding |
| Qdrant search | ~20ms | HNSW approximate |
| **Total search** | **~25ms** | Without LLM |
| | | |
| **Ask (search + LLM)** | | |
| Search | ~25ms | As above |
| Gemini generation | ~800-1500ms | Network + generation |
| **Total ask** | **~1-2 seconds** | With generated answer |

---

## Verification Plan

### Phase 1: Infrastructure
```bash
docker compose up -d
curl http://localhost:6333/healthz    # Qdrant healthy
curl http://localhost:8000/health     # FastAPI healthy
```

### Phase 2-8: Pipeline
1. Upload a multi-column PDF via existing UI
2. Check NestJS logs → should show `POST /rag/ingest` call
3. Check FastAPI logs → extraction → chunking → embedding → stored
4. Verify in Qdrant: `GET http://localhost:6333/collections/org_{orgId}` → shows points

### Phase 9-10: Versioning & Reindex
1. Upload new version → old chunks deleted, new chunks inserted
2. Search for old version content → not found
3. Trigger reindex → verify chunks regenerated

### Phase 11: Frontend
1. Navigate to `/documents/search`
2. Type query → results with scores appear
3. Toggle Semantic/Keyword/Hybrid → different ordering
4. Apply filters → results narrow
5. Click "Ask AI" → generated answer with sources
6. Press `Ctrl+K` anywhere → search overlay opens

---

## Open Questions

> [!IMPORTANT]
> **Gemini API Key:** You'll need a free key from [aistudio.google.com](https://aistudio.google.com). Should I include setup instructions in the plan?

> [!IMPORTANT]
> **Async Processing:** For large documents (100+ pages), ingestion takes ~2-5 seconds. Should I implement a background job queue (Redis-based) so the user gets immediate feedback with a progress indicator, or is synchronous processing acceptable for now?

> [!IMPORTANT]
> **Search Permissions:** Should all org members be able to search, or should it follow the existing `documents.read` permission? Should the AI Q&A (`/ask`) require a separate `ai.access` permission?

