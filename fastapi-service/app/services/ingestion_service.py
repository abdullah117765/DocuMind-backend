import time

from app.config.settings import get_settings
from app.models.rag import IngestDocumentRequest, IngestDocumentResponse, RagIndexStatus
from app.services.chunking_service import ChunkingService
from app.services.embedding_service import EmbeddingService
from app.services.extraction_service import ExtractionService
from app.services.minio_client import MinioDocumentClient
from app.services.qdrant_service import QdrantService


class IngestionService:
    def __init__(self) -> None:
        self.minio = MinioDocumentClient()
        self.extraction = ExtractionService()
        self.chunking = ChunkingService()
        self.embedding = EmbeddingService()
        self.qdrant = QdrantService()

    def ingest(self, request: IngestDocumentRequest) -> IngestDocumentResponse:
        started = time.perf_counter()

        try:
            file_bytes = self.minio.read_object(request.storage_bucket, request.storage_key)
            text = self.extraction.extract_text(file_bytes, request.file_type)
            chunks = self.chunking.chunk(text)

            if not chunks:
                self.qdrant.delete_document(request.organization_id, request.document_id)
                return IngestDocumentResponse(
                    status=RagIndexStatus.NO_CONTENT,
                    document_id=request.document_id,
                    chunks_created=0,
                    processing_time_ms=int((time.perf_counter() - started) * 1000),
                )

            embeddings = self.embedding.embed_chunks([str(chunk["text"]) for chunk in chunks])
            self.qdrant.upsert_chunks(request, chunks, embeddings)

            return IngestDocumentResponse(
                status=RagIndexStatus.INDEXED,
                document_id=request.document_id,
                chunks_created=len(chunks),
                processing_time_ms=int((time.perf_counter() - started) * 1000),
            )
        except Exception as exc:
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
