import time

from app.config.settings import get_settings
from app.models.rag import RagQueryRequest, RagSearchResponse, RagSearchResult, SearchType
from app.services.embedding_service import EmbeddingService
from app.services.qdrant_service import QdrantService


class SearchService:
    def __init__(self) -> None:
        self.embedding_service = EmbeddingService()
        self.qdrant_service = QdrantService()

    def search(self, request: RagQueryRequest) -> RagSearchResponse:
        started = time.perf_counter()
        top_k = min(request.top_k, get_settings().MAX_TOP_K)

        if request.search_type == SearchType.KEYWORD:
            results = self.qdrant_service.keyword_search(
                allowed_document_ids=request.allowed_document_ids,
                organization_id=request.organization_id,
                query=request.query,
                top_k=top_k,
            )
        elif request.search_type == SearchType.SEMANTIC:
            results = self._semantic(request, top_k)
        else:
            results = self._hybrid(request, top_k)

        return RagSearchResponse(
            results=results[:top_k],
            total_results=len(results[:top_k]),
            search_type=request.search_type,
            processing_time_ms=int((time.perf_counter() - started) * 1000),
        )

    def _semantic(self, request: RagQueryRequest, top_k: int) -> list[RagSearchResult]:
        return self.qdrant_service.semantic_search(
            allowed_document_ids=request.allowed_document_ids,
            organization_id=request.organization_id,
            query_vector=self.embedding_service.embed_query(request.query),
            top_k=top_k,
        )

    def _hybrid(self, request: RagQueryRequest, top_k: int) -> list[RagSearchResult]:
        semantic = self._semantic(request, top_k)
        keyword = self.qdrant_service.keyword_search(
            allowed_document_ids=request.allowed_document_ids,
            organization_id=request.organization_id,
            query=request.query,
            top_k=top_k,
        )
        scores: dict[tuple[str, int, int], tuple[float, RagSearchResult]] = {}

        for rank, result in enumerate(semantic, start=1):
            key = (result.document_id, result.version_number, result.chunk_index)
            scores[key] = (scores.get(key, (0.0, result))[0] + 1 / (60 + rank), result)

        for rank, result in enumerate(keyword, start=1):
            key = (result.document_id, result.version_number, result.chunk_index)
            existing_score, existing_result = scores.get(key, (0.0, result))
            scores[key] = (existing_score + 1 / (60 + rank), existing_result)

        merged = []
        for score, result in scores.values():
            merged.append(result.model_copy(update={"score": score}))

        return sorted(merged, key=lambda item: item.score, reverse=True)
