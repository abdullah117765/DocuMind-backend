import logging
import math
import re
import time
from functools import cached_property

from app.config.settings import get_settings
from app.models.rag import RagSearchResult

logger = logging.getLogger(__name__)


TOKEN_PATTERN = re.compile(r"[a-z0-9]+", re.IGNORECASE)


class RerankerService:
    @cached_property
    def model(self):
        from sentence_transformers import CrossEncoder

        return CrossEncoder(get_settings().RAG_RERANKER_MODEL)

    def rerank(
        self,
        query: str,
        candidates: list[RagSearchResult],
    ) -> list[RagSearchResult]:
        if not candidates:
            return []

        settings = get_settings()

        if settings.RAG_RERANKER_ENABLED:
            try:
                started = time.perf_counter()
                logger.info(
                    "RAG reranker started type=cross_encoder model=%s candidates=%s",
                    settings.RAG_RERANKER_MODEL,
                    len(candidates),
                )
                results = self._cross_encoder_rerank(query, candidates)
                logger.info(
                    "RAG reranker completed type=cross_encoder candidates=%s elapsed_ms=%s",
                    len(results),
                    int((time.perf_counter() - started) * 1000),
                )
                return results
            except Exception as error:
                logger.warning(
                    "Cross-encoder reranker failed; using lightweight rerank: %s",
                    error,
                )

        started = time.perf_counter()
        results = self._lightweight_rerank(query, candidates)
        logger.info(
            "RAG reranker completed type=lightweight candidates=%s elapsed_ms=%s",
            len(results),
            int((time.perf_counter() - started) * 1000),
        )

        return results

    def _cross_encoder_rerank(
        self,
        query: str,
        candidates: list[RagSearchResult],
    ) -> list[RagSearchResult]:
        settings = get_settings()
        pairs = [(query, candidate.text) for candidate in candidates]
        raw_scores = self.model.predict(pairs)
        reranked: list[RagSearchResult] = []

        for candidate, raw_score in zip(candidates, raw_scores, strict=True):
            reranker_score = self._sigmoid(float(raw_score))
            retrieval_score = self._safe_score(candidate.score)
            combined_score = self._blend_scores(retrieval_score, reranker_score)
            reranked.append(
                candidate.model_copy(
                    update={
                        "score": combined_score,
                        "metadata": {
                            **candidate.metadata,
                            "retrieval_score": retrieval_score,
                            "reranker_score": reranker_score,
                            "reranker_model": settings.RAG_RERANKER_MODEL,
                            "reranker_type": "cross_encoder",
                        },
                    }
                )
            )

        return sorted(reranked, key=lambda item: item.score, reverse=True)

    def _lightweight_rerank(
        self,
        query: str,
        candidates: list[RagSearchResult],
    ) -> list[RagSearchResult]:
        reranked: list[RagSearchResult] = []

        for candidate in candidates:
            retrieval_score = self._safe_score(candidate.score)
            lexical_score = self._lexical_overlap_score(query, candidate.text)
            combined_score = (retrieval_score * 0.7) + (lexical_score * 0.3)
            reranked.append(
                candidate.model_copy(
                    update={
                        "score": combined_score,
                        "metadata": {
                            **candidate.metadata,
                            "retrieval_score": retrieval_score,
                            "reranker_score": lexical_score,
                            "reranker_type": "lightweight",
                        },
                    }
                )
            )

        return sorted(reranked, key=lambda item: item.score, reverse=True)

    def _blend_scores(self, retrieval_score: float, reranker_score: float) -> float:
        weight = min(max(get_settings().RAG_RERANKER_WEIGHT, 0.0), 1.0)

        return (reranker_score * weight) + (retrieval_score * (1 - weight))

    def _lexical_overlap_score(self, query: str, text: str) -> float:
        query_terms = set(self._tokens(query))
        text_terms = set(self._tokens(text))

        if not query_terms or not text_terms:
            return 0.0

        overlap = len(query_terms.intersection(text_terms))

        return min(overlap / math.sqrt(len(query_terms) * len(text_terms)), 1.0)

    def _tokens(self, value: str) -> list[str]:
        return TOKEN_PATTERN.findall(value.lower())

    def _safe_score(self, score: object) -> float:
        if score is None:
            return 0.0

        try:
            return min(max(float(score), 0.0), 1.0)
        except (TypeError, ValueError):
            return 0.0

    def _sigmoid(self, value: float) -> float:
        if value >= 0:
            z = math.exp(-value)
            return 1 / (1 + z)

        z = math.exp(value)
        return z / (1 + z)
