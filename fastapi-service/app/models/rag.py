from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class RagIndexStatus(str, Enum):
    PENDING = "PENDING"
    INDEXING = "INDEXING"
    INDEXED = "INDEXED"
    FAILED = "FAILED"
    NO_CONTENT = "NO_CONTENT"


class SearchType(str, Enum):
    SEMANTIC = "semantic"
    KEYWORD = "keyword"
    HYBRID = "hybrid"


class IngestDocumentRequest(BaseModel):
    document_id: str
    organization_id: str
    version_id: str | None = None
    version_number: int = 1
    document_name: str
    file_type: str
    storage_bucket: str
    storage_key: str
    uploaded_by_id: str | None = None


class IngestDocumentResponse(BaseModel):
    status: RagIndexStatus
    document_id: str
    chunks_created: int = 0
    error_message: str | None = None
    processing_time_ms: int


class RagQueryRequest(BaseModel):
    organization_id: str
    query: str = Field(min_length=1, max_length=4000)
    allowed_document_ids: list[str] = Field(default_factory=list)
    search_type: SearchType = SearchType.HYBRID
    top_k: int = Field(default=5, ge=1, le=20)


class RagSearchResult(BaseModel):
    score: float
    text: str
    document_id: str
    document_name: str
    file_type: str | None = None
    chunk_index: int
    version_number: int
    metadata: dict[str, Any] = Field(default_factory=dict)


class RagSearchResponse(BaseModel):
    results: list[RagSearchResult]
    total_results: int
    search_type: SearchType
    processing_time_ms: int


class RagSource(BaseModel):
    document_id: str
    document_name: str
    chunk_index: int
    version_number: int


class RagAskResponse(BaseModel):
    answer: str
    sources: list[RagSource]
    search_results: list[RagSearchResult]
    llm_model: str | None = None
    llm_available: bool
    processing_time_ms: int


class RagDeleteDocumentResponse(BaseModel):
    status: Literal["success"]
    document_id: str


class RagStatsResponse(BaseModel):
    organization_id: str
    vectors_count: int | None = None
    status: Literal["success"] = "success"
