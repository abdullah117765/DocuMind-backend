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
    DEFAULT_TOP_K: int = 5
    MAX_TOP_K: int = 20

    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.5-flash"


@lru_cache
def get_settings() -> Settings:
    return Settings()
