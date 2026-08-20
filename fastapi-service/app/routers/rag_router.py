import time

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.middleware.hmac_middleware import require_hmac
from app.models.rag import (
    IngestDocumentRequest,
    IngestDocumentResponse,
    RagAskResponse,
    RagDeleteDocumentResponse,
    RagQueryRequest,
    RagSearchResponse,
    RagSource,
    RagStatsResponse,
)
from app.services.ingestion_service import IngestionService
from app.services.llm_service import LlmService
from app.services.search_service import SearchService


def require_rag_ready(request: Request) -> None:
    if not bool(getattr(request.app.state, "rag_ready", False)):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Document AI service is warming up. Retry shortly.",
        )


router = APIRouter(
    prefix="/rag",
    tags=["RAG"],
    dependencies=[Depends(require_hmac), Depends(require_rag_ready)],
)


def _ingestion_service(request: Request) -> IngestionService:
    return request.app.state.ingestion_service


def _search_service(request: Request) -> SearchService:
    return request.app.state.search_service


def _llm_service(request: Request) -> LlmService:
    return request.app.state.llm_service


def _metadata_int(metadata: dict[str, object], key: str) -> int | None:
    value = metadata.get(key)

    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _metadata_str(metadata: dict[str, object], key: str) -> str | None:
    value = metadata.get(key)

    if isinstance(value, str) and value.strip():
        return value.strip()

    return None


def _source_location_label(result: object) -> str:
    metadata = getattr(result, "metadata", {}) or {}
    direct_label = _metadata_str(metadata, "location_label")

    if direct_label:
        return direct_label

    page_number = _metadata_int(metadata, "page_number")
    if page_number is not None:
        return f"Page {page_number}"

    slide_number = _metadata_int(metadata, "slide_number")
    if slide_number is not None:
        return f"Slide {slide_number}"

    section_title = _metadata_str(metadata, "section_title")
    if section_title:
        return section_title

    sheet_name = _metadata_str(metadata, "sheet_name")
    line_start = _metadata_int(metadata, "line_start")
    line_end = _metadata_int(metadata, "line_end")

    if sheet_name and line_start is not None and line_end is not None:
        return f'{sheet_name}, lines {line_start}-{line_end}'

    if line_start is not None and line_end is not None:
        return f"Line {line_start}" if line_start == line_end else f"Lines {line_start}-{line_end}"

    chunk_index = getattr(result, "chunk_index", None)
    if isinstance(chunk_index, int) and chunk_index >= 0:
        return f"Passage {chunk_index + 1}"

    return "Selected passage"


@router.post(
    "/ingest",
    response_model=IngestDocumentResponse,
    status_code=status.HTTP_200_OK,
)
def ingest_document(
    payload: IngestDocumentRequest,
    request: Request,
) -> IngestDocumentResponse:
    return _ingestion_service(request).ingest(payload)


@router.post(
    "/search",
    response_model=RagSearchResponse,
    status_code=status.HTTP_200_OK,
)
def search_documents(payload: RagQueryRequest, request: Request) -> RagSearchResponse:
    return _search_service(request).search(payload)


@router.post(
    "/ask",
    response_model=RagAskResponse,
    status_code=status.HTTP_200_OK,
)
def ask_documents(payload: RagQueryRequest, request: Request) -> RagAskResponse:
    started = time.perf_counter()
    search_service = _search_service(request)
    llm_service = _llm_service(request)
    search_response = search_service.search(payload)

    if not search_response.results:
        return RagAskResponse(
            answer="Not available in the selected documents.",
            sources=[],
            search_results=[],
            llm_model=None,
            llm_available=llm_service.is_available,
            processing_time_ms=int((time.perf_counter() - started) * 1000),
        )

    answer, model, llm_available = llm_service.answer(
        payload.query,
        search_response.results,
    )
    sources = [
        RagSource(
            document_id=result.document_id,
            document_name=result.document_name,
            chunk_index=result.chunk_index,
            version_number=result.version_number,
            file_type=result.file_type,
            score=result.score,
            text=result.text,
            page_number=_metadata_int(result.metadata, "page_number"),
            slide_number=_metadata_int(result.metadata, "slide_number"),
            sheet_name=_metadata_str(result.metadata, "sheet_name"),
            line_start=_metadata_int(result.metadata, "line_start"),
            line_end=_metadata_int(result.metadata, "line_end"),
            section_title=_metadata_str(result.metadata, "section_title"),
            location_label=_source_location_label(result),
            metadata=result.metadata,
        )
        for result in search_response.results
    ]

    return RagAskResponse(
        answer=answer,
        sources=sources,
        search_results=search_response.results,
        llm_model=model,
        llm_available=llm_available,
        processing_time_ms=int((time.perf_counter() - started) * 1000),
    )


@router.post(
    "/reindex",
    response_model=list[IngestDocumentResponse],
    status_code=status.HTTP_200_OK,
)
def reindex_documents(
    payload: list[IngestDocumentRequest],
    request: Request,
) -> list[IngestDocumentResponse]:
    ingestion_service = _ingestion_service(request)

    return [ingestion_service.ingest(document) for document in payload]


@router.delete(
    "/documents/{organization_id}/{document_id}",
    response_model=RagDeleteDocumentResponse,
    status_code=status.HTTP_200_OK,
)
def delete_document_vectors(
    organization_id: str,
    document_id: str,
    request: Request,
) -> RagDeleteDocumentResponse:
    _ingestion_service(request).delete_document(organization_id, document_id)
    return RagDeleteDocumentResponse(status="success", document_id=document_id)


@router.delete(
    "/organizations/{organization_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_organization_vectors(organization_id: str, request: Request) -> None:
    _ingestion_service(request).delete_organization(organization_id)


@router.get(
    "/stats/{organization_id}",
    response_model=RagStatsResponse,
    status_code=status.HTTP_200_OK,
)
def get_stats(organization_id: str, request: Request) -> RagStatsResponse:
    return RagStatsResponse(
        organization_id=organization_id,
        vectors_count=_ingestion_service(request).count_vectors(organization_id),
    )
