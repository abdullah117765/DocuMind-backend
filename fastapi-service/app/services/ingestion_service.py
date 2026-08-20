import time
import logging

from app.config.settings import get_settings
from app.models.rag import IngestDocumentRequest, IngestDocumentResponse, RagIndexStatus
from app.services.chunking_service import ChunkingService
from app.services.embedding_service import EmbeddingService
from app.services.extraction_service import ExtractionService
from app.services.minio_client import MinioDocumentClient
from app.services.qdrant_service import QdrantService


logger = logging.getLogger(__name__)


class IngestionService:
    def __init__(
        self,
        *,
        embedding_service: EmbeddingService | None = None,
        qdrant_service: QdrantService | None = None,
    ) -> None:
        self.minio = MinioDocumentClient()
        self.extraction = ExtractionService()
        self.chunking = ChunkingService()
        self.embedding = embedding_service or EmbeddingService()
        self.qdrant = qdrant_service or QdrantService()

    def ingest(self, request: IngestDocumentRequest) -> IngestDocumentResponse:
        started = time.perf_counter()

        try:
            logger.info(
                "RAG ingest started document_id=%s organization_id=%s file_type=%s",
                request.document_id,
                request.organization_id,
                request.file_type,
            )
            stage_started = time.perf_counter()
            file_bytes = self.minio.read_object(request.storage_bucket, request.storage_key)
            logger.info(
                "RAG ingest storage read document_id=%s bytes=%s elapsed_ms=%s",
                request.document_id,
                len(file_bytes),
                int((time.perf_counter() - stage_started) * 1000),
            )
            stage_started = time.perf_counter()
            text, locations = self.extraction.extract_text_with_locations(
                file_bytes,
                request.file_type,
            )
            logger.info(
                "RAG ingest text extracted document_id=%s chars=%s locations=%s elapsed_ms=%s",
                request.document_id,
                len(text),
                len(locations),
                int((time.perf_counter() - stage_started) * 1000),
            )
            stage_started = time.perf_counter()
            chunks = self.chunking.chunk(text, request.file_type, locations=locations)
            logger.info(
                "RAG ingest chunked document_id=%s chunks=%s elapsed_ms=%s",
                request.document_id,
                len(chunks),
                int((time.perf_counter() - stage_started) * 1000),
            )

            if not chunks:
                self.qdrant.delete_document_version(
                    request.organization_id,
                    request.document_id,
                    request.version_id,
                    request.version_number,
                )
                logger.info(
                    "RAG ingest completed with no content document_id=%s elapsed_ms=%s",
                    request.document_id,
                    int((time.perf_counter() - started) * 1000),
                )
                return IngestDocumentResponse(
                    status=RagIndexStatus.NO_CONTENT,
                    document_id=request.document_id,
                    chunks_created=0,
                    processing_time_ms=int((time.perf_counter() - started) * 1000),
                )

            stage_started = time.perf_counter()
            embeddings = self.embedding.embed_chunks([str(chunk["text"]) for chunk in chunks])
            logger.info(
                "RAG ingest embeddings created document_id=%s vectors=%s elapsed_ms=%s",
                request.document_id,
                len(embeddings),
                int((time.perf_counter() - stage_started) * 1000),
            )
            stage_started = time.perf_counter()
            self.qdrant.upsert_chunks(request, chunks, embeddings)
            logger.info(
                "RAG ingest vectors upserted document_id=%s elapsed_ms=%s",
                request.document_id,
                int((time.perf_counter() - stage_started) * 1000),
            )

            logger.info(
                "RAG ingest completed document_id=%s chunks=%s elapsed_ms=%s",
                request.document_id,
                len(chunks),
                int((time.perf_counter() - started) * 1000),
            )
            return IngestDocumentResponse(
                status=RagIndexStatus.INDEXED,
                document_id=request.document_id,
                chunks_created=len(chunks),
                processing_time_ms=int((time.perf_counter() - started) * 1000),
            )
        except Exception as exc:
            logger.exception("RAG ingest failed document_id=%s", request.document_id)
            return IngestDocumentResponse(
                status=RagIndexStatus.FAILED,
                document_id=request.document_id,
                chunks_created=0,
                error_message=str(exc)[:1000],
                processing_time_ms=int((time.perf_counter() - started) * 1000),
            )

    def delete_document(self, organization_id: str, document_id: str) -> None:
        self.qdrant.delete_document(organization_id, document_id)

    def delete_organization(self, organization_id: str) -> None:
        self.qdrant.delete_organization(organization_id)

    def count_vectors(self, organization_id: str) -> int | None:
        return self.qdrant.count_vectors(organization_id)

    @property
    def embedding_model(self) -> str:
        return get_settings().EMBEDDING_MODEL
