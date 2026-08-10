import logging
import re
import time

from app.config.settings import get_settings
from app.models.rag import (
    RagQueryRequest,
    RagSearchResponse,
    RagSearchResult,
    SearchType,
)
from app.services.embedding_service import EmbeddingService
from app.services.qdrant_service import QdrantService
from app.services.reranker_service import RerankerService


TOKEN_PATTERN = re.compile(r"[a-z0-9]+", re.IGNORECASE)
logger = logging.getLogger(__name__)


class SearchService:
    def __init__(self) -> None:
        self.embedding_service = EmbeddingService()
        self.qdrant_service = QdrantService()
        self.reranker_service = RerankerService()

    def search(self, request: RagQueryRequest) -> RagSearchResponse:
        started = time.perf_counter()
        candidate_k = self._candidate_k()
        logger.info(
            "RAG search started organization_id=%s allowed_documents=%s search_type=%s candidate_k=%s",
            request.organization_id,
            len(request.allowed_document_ids),
            request.search_type,
            candidate_k,
        )
        stage_started = time.perf_counter()
        candidates = self._retrieve_candidates(request, candidate_k)
        logger.info(
            "RAG search retrieved candidates=%s elapsed_ms=%s",
            len(candidates),
            int((time.perf_counter() - stage_started) * 1000),
        )
        stage_started = time.perf_counter()
        relevant_candidates = self._filter_relevant_candidates(candidates)
        logger.info(
            "RAG search relevance filtered candidates=%s elapsed_ms=%s",
            len(relevant_candidates),
            int((time.perf_counter() - stage_started) * 1000),
        )
        stage_started = time.perf_counter()
        reranked_candidates = self.reranker_service.rerank(
            request.query,
            relevant_candidates,
        )
        logger.info(
            "RAG search reranked candidates=%s elapsed_ms=%s",
            len(reranked_candidates),
            int((time.perf_counter() - stage_started) * 1000),
        )
        stage_started = time.perf_counter()
        selected_results = self._select_context_chunks(reranked_candidates)
        logger.info(
            "RAG search selected final_chunks=%s elapsed_ms=%s total_elapsed_ms=%s",
            len(selected_results),
            int((time.perf_counter() - stage_started) * 1000),
            int((time.perf_counter() - started) * 1000),
        )

        return RagSearchResponse(
            results=selected_results,
            total_results=len(selected_results),
            search_type=request.search_type,
            processing_time_ms=int((time.perf_counter() - started) * 1000),
        )

    def _candidate_k(self) -> int:
        settings = get_settings()
        configured = max(settings.RAG_INITIAL_CANDIDATE_K, 1)
        maximum = max(settings.RAG_MAX_CANDIDATE_K, 1)

        return min(configured, maximum)

    def _retrieve_candidates(
        self,
        request: RagQueryRequest,
        candidate_k: int,
    ) -> list[RagSearchResult]:
        if request.search_type == SearchType.KEYWORD:
            return self._keyword(request, candidate_k)

        if request.search_type == SearchType.SEMANTIC:
            return self._semantic(request, candidate_k)

        return self._hybrid(request, candidate_k)

    def _semantic(
        self,
        request: RagQueryRequest,
        candidate_k: int,
    ) -> list[RagSearchResult]:
        query_vector = self.embedding_service.embed_query(request.query)
        results = self.qdrant_service.semantic_search(
            allowed_document_ids=request.allowed_document_ids,
            organization_id=request.organization_id,
            query_vector=query_vector,
            top_k=candidate_k,
        )

        return [
            self._with_score_metadata(
                result,
                retrieval_score=self._normalize_score(result.score),
                retrieval_type="semantic",
                semantic_score=self._normalize_score(result.score),
            )
            for result in results
        ]

    def _keyword(
        self,
        request: RagQueryRequest,
        candidate_k: int,
    ) -> list[RagSearchResult]:
        results = self.qdrant_service.keyword_search(
            allowed_document_ids=request.allowed_document_ids,
            organization_id=request.organization_id,
            query=request.query,
            top_k=candidate_k,
        )

        scored_results = []

        for result in results:
            keyword_score = self._keyword_relevance_score(request.query, result.text)
            scored_results.append(
                self._with_score_metadata(
                    result,
                    retrieval_score=keyword_score,
                    retrieval_type="keyword",
                    keyword_score=keyword_score,
                )
            )

        return sorted(scored_results, key=lambda item: item.score, reverse=True)

    def _hybrid(
        self,
        request: RagQueryRequest,
        candidate_k: int,
    ) -> list[RagSearchResult]:
        semantic = self._semantic(request, candidate_k)
        keyword = self._keyword(request, candidate_k)
        merged: dict[tuple[str, int, int], RagSearchResult] = {}

        for result in semantic:
            key = self._result_key(result)
            merged[key] = result

        for result in keyword:
            key = self._result_key(result)
            existing = merged.get(key)

            if not existing:
                merged[key] = result
                continue

            semantic_score = self._normalize_score(
                existing.metadata.get("semantic_score") or existing.score,
            )
            keyword_score = self._normalize_score(
                result.metadata.get("keyword_score") or result.score,
            )
            combined_score = min(
                max(semantic_score, keyword_score)
                + (min(semantic_score, keyword_score) * 0.15),
                1.0,
            )
            merged[key] = existing.model_copy(
                update={
                    "score": combined_score,
                    "metadata": {
                        **existing.metadata,
                        **result.metadata,
                        "retrieval_score": combined_score,
                        "retrieval_type": "hybrid",
                    },
                }
            )

        return sorted(merged.values(), key=lambda item: item.score, reverse=True)[
            :candidate_k
        ]

    def _filter_relevant_candidates(
        self,
        candidates: list[RagSearchResult],
    ) -> list[RagSearchResult]:
        minimum_score = min(max(get_settings().RAG_MIN_RELEVANCE_SCORE, 0.0), 1.0)

        return [
            candidate
            for candidate in candidates
            if self._normalize_score(candidate.score) >= minimum_score
        ]

    def _select_context_chunks(
        self,
        candidates: list[RagSearchResult],
    ) -> list[RagSearchResult]:
        settings = get_settings()
        max_final_chunks = max(settings.RAG_MAX_FINAL_CHUNKS, 1)
        max_context_tokens = max(settings.RAG_MAX_CONTEXT_TOKENS, 1)
        metadata_tokens = max(settings.RAG_CONTEXT_METADATA_TOKENS, 0)
        minimum_reranked_score = min(
            max(settings.RAG_MIN_RERANKED_SCORE, 0.0),
            1.0,
        )
        selected: list[RagSearchResult] = []
        used_tokens = 0

        for candidate in candidates:
            if len(selected) >= max_final_chunks:
                break

            if self._normalize_score(candidate.score) < minimum_reranked_score:
                continue

            if self._is_redundant(candidate, selected):
                continue

            estimated_tokens = self._estimate_tokens(candidate.text) + metadata_tokens

            if estimated_tokens > max_context_tokens and not selected:
                selected.append(
                    self._trim_to_budget(
                        candidate,
                        max(max_context_tokens - metadata_tokens, 1),
                    )
                )
                break

            if used_tokens + estimated_tokens > max_context_tokens:
                break

            selected.append(candidate)
            used_tokens += estimated_tokens

        return selected

    def _trim_to_budget(
        self,
        candidate: RagSearchResult,
        token_budget: int,
    ) -> RagSearchResult:
        max_chars = max(token_budget * 4, 160)
        trimmed_text = candidate.text[:max_chars].rstrip()

        if len(trimmed_text) < len(candidate.text):
            trimmed_text = f"{trimmed_text}..."

        return candidate.model_copy(
            update={
                "text": trimmed_text,
                "metadata": {
                    **candidate.metadata,
                    "trimmed_for_context": True,
                    "original_text_length": len(candidate.text),
                },
            }
        )

    def _is_redundant(
        self,
        candidate: RagSearchResult,
        selected: list[RagSearchResult],
    ) -> bool:
        candidate_signature = self._text_signature(candidate.text)

        for existing in selected:
            if candidate_signature == self._text_signature(existing.text):
                return True

            if (
                self._jaccard_similarity(candidate.text, existing.text)
                >= get_settings().RAG_REDUNDANCY_THRESHOLD
            ):
                return True

        return False

    def _with_score_metadata(
        self,
        result: RagSearchResult,
        *,
        retrieval_score: float,
        retrieval_type: str,
        semantic_score: float | None = None,
        keyword_score: float | None = None,
    ) -> RagSearchResult:
        metadata = {
            **result.metadata,
            "retrieval_score": retrieval_score,
            "retrieval_type": retrieval_type,
        }

        if semantic_score is not None:
            metadata["semantic_score"] = semantic_score

        if keyword_score is not None:
            metadata["keyword_score"] = keyword_score

        return result.model_copy(
            update={
                "score": retrieval_score,
                "metadata": metadata,
            }
        )

    def _keyword_relevance_score(self, query: str, text: str) -> float:
        query_terms = set(self._tokens(query))
        text_terms = set(self._tokens(text))

        if not query_terms or not text_terms:
            return 0.0

        overlap = len(query_terms.intersection(text_terms))
        phrase_bonus = 0.2 if query.lower().strip() in text.lower() else 0.0
        coverage = overlap / len(query_terms)
        density = overlap / max(len(text_terms), 1)

        return min((coverage * 0.75) + (density * 0.25) + phrase_bonus, 1.0)

    def _normalize_score(self, score: object) -> float:
        if score is None:
            return 0.0

        try:
            return min(max(float(score), 0.0), 1.0)
        except (TypeError, ValueError):
            return 0.0

    def _estimate_tokens(self, text: str) -> int:
        words = len(self._tokens(text))
        char_estimate = max(len(text) // 4, 1)
        word_estimate = int(words * 1.3)

        return max(char_estimate, word_estimate, 1)

    def _jaccard_similarity(self, left: str, right: str) -> float:
        left_terms = set(self._tokens(left))
        right_terms = set(self._tokens(right))

        if not left_terms or not right_terms:
            return 0.0

        return len(left_terms.intersection(right_terms)) / len(
            left_terms.union(right_terms),
        )

    def _text_signature(self, text: str) -> str:
        return " ".join(self._tokens(text)[:120])

    def _tokens(self, value: str) -> list[str]:
        return TOKEN_PATTERN.findall(value.lower())

    def _result_key(self, result: RagSearchResult) -> tuple[str, int, int]:
        return (result.document_id, result.version_number, result.chunk_index)
