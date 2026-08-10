import time

from fastapi import APIRouter, Depends, status

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

router = APIRouter(prefix="/rag", tags=["RAG"], dependencies=[Depends(require_hmac)])

ingestion_service = IngestionService()
search_service = SearchService()
llm_service = LlmService()


@router.post(
    "/ingest",
    response_model=IngestDocumentResponse,
    status_code=status.HTTP_200_OK,
)
async def ingest_document(request: IngestDocumentRequest) -> IngestDocumentResponse:
    return ingestion_service.ingest(request)


@router.post(
    "/search",
    response_model=RagSearchResponse,
    status_code=status.HTTP_200_OK,
)
async def search_documents(request: RagQueryRequest) -> RagSearchResponse:
    return search_service.search(request)


@router.post(
    "/ask",
    response_model=RagAskResponse,
    status_code=status.HTTP_200_OK,
)
async def ask_documents(request: RagQueryRequest) -> RagAskResponse:
    started = time.perf_counter()
    search_response = search_service.search(request)

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
        request.query,
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
async def reindex_documents(
    request: list[IngestDocumentRequest],
) -> list[IngestDocumentResponse]:
    return [ingestion_service.ingest(document) for document in request]


@router.delete(
    "/documents/{organization_id}/{document_id}",
    response_model=RagDeleteDocumentResponse,
    status_code=status.HTTP_200_OK,
)
async def delete_document_vectors(
    organization_id: str,
    document_id: str,
) -> RagDeleteDocumentResponse:
    ingestion_service.delete_document(organization_id, document_id)
    return RagDeleteDocumentResponse(status="success", document_id=document_id)


@router.delete(
    "/organizations/{organization_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_organization_vectors(organization_id: str) -> None:
    ingestion_service.delete_organization(organization_id)


@router.get(
    "/stats/{organization_id}",
    response_model=RagStatsResponse,
    status_code=status.HTTP_200_OK,
)
async def get_stats(organization_id: str) -> RagStatsResponse:
    return RagStatsResponse(
        organization_id=organization_id,
        vectors_count=ingestion_service.count_vectors(organization_id),
    )
