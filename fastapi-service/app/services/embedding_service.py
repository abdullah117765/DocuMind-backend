from functools import lru_cache

from app.config.settings import get_settings


@lru_cache(maxsize=4)
def _load_sentence_transformer(model_name: str):
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(model_name)


class EmbeddingService:
    @property
    def model(self):
        return _load_sentence_transformer(get_settings().EMBEDDING_MODEL)

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
