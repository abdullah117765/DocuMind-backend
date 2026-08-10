from functools import cached_property

from app.config.settings import get_settings


class EmbeddingService:
    @cached_property
    def model(self):
        from sentence_transformers import SentenceTransformer

        return SentenceTransformer(get_settings().EMBEDDING_MODEL)

    def embed_chunks(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        return self.model.encode(
            texts,
            batch_size=32,
            normalize_embeddings=True,
        ).tolist()

    def embed_query(self, query: str) -> list[float]:
        settings = get_settings()
        query_text = f"{settings.EMBEDDING_QUERY_PREFIX} {query}".strip()

        return self.model.encode(query_text, normalize_embeddings=True).tolist()
