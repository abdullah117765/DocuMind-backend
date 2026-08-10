from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    APP_ENV: str = "development"
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    HMAC_SECRET: str
    HMAC_TIMESTAMP_TOLERANCE_SECONDS: int = 300

    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin123"
    MINIO_USE_SSL: bool = False
    MINIO_DOCUMENT_BUCKET: str = "documents"

    QDRANT_HOST: str = "localhost"
    QDRANT_PORT: int = 6333

    EMBEDDING_MODEL: str = "BAAI/bge-small-en-v1.5"
    EMBEDDING_DIMENSIONS: int = 384
    EMBEDDING_QUERY_PREFIX: str = "Represent this sentence:"

    CHUNK_SIZE: int = 500
    CHUNK_OVERLAP: int = 50

    RAG_INITIAL_CANDIDATE_K: int = 30
    RAG_MAX_CANDIDATE_K: int = 50
    RAG_MIN_RELEVANCE_SCORE: float = 0.2
    RAG_RERANKER_ENABLED: bool = False
    RAG_RERANKER_MODEL: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    RAG_RERANKER_WEIGHT: float = 0.75
    RAG_MIN_RERANKED_SCORE: float = 0.2
    RAG_MAX_FINAL_CHUNKS: int = 10
    RAG_MAX_CONTEXT_TOKENS: int = 3000
    RAG_CONTEXT_METADATA_TOKENS: int = 80
    RAG_REDUNDANCY_THRESHOLD: float = 0.88

    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.5-flash"
    GEMINI_REQUEST_TIMEOUT_MS: int = 20_000
    GEMINI_TOTAL_TIMEOUT_MS: int = 25_000
    GEMINI_MAX_RETRIES: int = 2
    GEMINI_RETRY_INITIAL_BACKOFF_MS: int = 1_000
    GEMINI_RETRY_MAX_BACKOFF_MS: int = 2_000


@lru_cache
def get_settings() -> Settings:
    return Settings()
