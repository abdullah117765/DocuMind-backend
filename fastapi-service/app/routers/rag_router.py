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
            answer="No relevant documents were found in the selected scope.",
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
