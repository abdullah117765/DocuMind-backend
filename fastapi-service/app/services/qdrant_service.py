from uuid import uuid5, NAMESPACE_URL

from qdrant_client import QdrantClient, models

from app.config.settings import get_settings
from app.models.rag import IngestDocumentRequest, RagSearchResult


def collection_name(organization_id: str) -> str:
    return f"org_{organization_id.replace('-', '_')}"


class QdrantService:
    def __init__(self) -> None:
        settings = get_settings()
        self.settings = settings
        self.client = QdrantClient(host=settings.QDRANT_HOST, port=settings.QDRANT_PORT)

    def ensure_collection(self, organization_id: str) -> None:
        name = collection_name(organization_id)

        if self.client.collection_exists(name):
            return

        self.client.create_collection(
            collection_name=name,
            vectors_config=models.VectorParams(
                size=self.settings.EMBEDDING_DIMENSIONS,
                distance=models.Distance.COSINE,
            ),
        )
        self._create_payload_index(name, "document_id", models.PayloadSchemaType.KEYWORD)
        self._create_payload_index(name, "version_id", models.PayloadSchemaType.KEYWORD)
        self._create_payload_index(name, "version_number", models.PayloadSchemaType.INTEGER)
        self._create_payload_index(name, "status", models.PayloadSchemaType.KEYWORD)
        self._create_payload_index(name, "file_type", models.PayloadSchemaType.KEYWORD)
        self._create_payload_index(name, "text", models.TextIndexParams(type="text"))

    def delete_document(self, organization_id: str, document_id: str) -> None:
        name = collection_name(organization_id)
        if not self.client.collection_exists(name):
            return

        self.client.delete(
            collection_name=name,
            points_selector=models.FilterSelector(
                filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="document_id",
                            match=models.MatchValue(value=document_id),
                        )
                    ]
                )
            ),
        )

    def delete_document_version(
        self,
        organization_id: str,
        document_id: str,
        version_id: str | None,
        version_number: int | None,
    ) -> None:
        name = collection_name(organization_id)
        if not self.client.collection_exists(name):
            return

        must = [
            models.FieldCondition(
                key="document_id",
                match=models.MatchValue(value=document_id),
            )
        ]

        if version_id:
            must.append(
                models.FieldCondition(
                    key="version_id",
                    match=models.MatchValue(value=version_id),
                )
            )
        elif version_number:
            must.append(
                models.FieldCondition(
                    key="version_number",
                    match=models.MatchValue(value=version_number),
                )
            )
        else:
            self.delete_document(organization_id, document_id)
            return

        self.client.delete(
            collection_name=name,
            points_selector=models.FilterSelector(filter=models.Filter(must=must)),
        )

    def delete_organization(self, organization_id: str) -> None:
        name = collection_name(organization_id)
        if self.client.collection_exists(name):
            self.client.delete_collection(name)

    def upsert_chunks(
        self,
        request: IngestDocumentRequest,
        chunks: list[dict[str, object]],
        embeddings: list[list[float]],
    ) -> None:
        self.ensure_collection(request.organization_id)
        self.delete_document_version(
            request.organization_id,
            request.document_id,
            request.version_id,
            request.version_number,
        )
        total = len(chunks)
        points = []

        for chunk, vector in zip(chunks, embeddings, strict=True):
            chunk_index = int(chunk["index"])
            point_id = str(uuid5(NAMESPACE_URL, f"{request.document_id}:{request.version_number}:{chunk_index}"))
            points.append(
                models.PointStruct(
                    id=point_id,
                    vector=vector,
                    payload={
                        "document_id": request.document_id,
                        "organization_id": request.organization_id,
                        "version_id": request.version_id,
                        "version_number": request.version_number,
                        "document_name": request.document_name,
                        "file_type": request.file_type,
                        "chunk_index": chunk_index,
                        "chunk_total": total,
                        "char_start": chunk["char_start"],
                        "char_end": chunk["char_end"],
                        "location_type": chunk.get("location_type"),
                        "location_label": chunk.get("location_label"),
                        "page_number": chunk.get("page_number"),
                        "slide_number": chunk.get("slide_number"),
                        "sheet_name": chunk.get("sheet_name"),
                        "line_start": chunk.get("line_start"),
                        "line_end": chunk.get("line_end"),
                        "section_title": chunk.get("section_title"),
                        "preview_type": chunk.get("preview_type"),
                        "source_file_type": chunk.get("source_file_type"),
                        "highlight_boxes": chunk.get("highlight_boxes"),
                        "text": chunk["text"],
                        "uploaded_by_id": request.uploaded_by_id,
                        "status": "ACTIVE",
                    },
                )
            )

        if points:
            self.client.upsert(collection_name=collection_name(request.organization_id), points=points)

    def semantic_search(
        self,
        *,
        allowed_document_ids: list[str],
        organization_id: str,
        query_vector: list[float],
        top_k: int,
    ) -> list[RagSearchResult]:
        if not allowed_document_ids:
            return []

        name = collection_name(organization_id)
        if not self.client.collection_exists(name):
            return []

        query_filter = self._allowed_documents_filter(
            allowed_document_ids,
            organization_id,
        )

        try:
            points = self.client.search(
                collection_name=name,
                query_vector=query_vector,
                query_filter=query_filter,
                limit=top_k,
                with_payload=True,
            )
        except AttributeError:
            points = self.client.query_points(
                collection_name=name,
                query=query_vector,
                query_filter=query_filter,
                limit=top_k,
                with_payload=True,
            ).points

        return [self._point_to_result(point) for point in points]

    def keyword_search(
        self,
        *,
        allowed_document_ids: list[str],
        organization_id: str,
        query: str,
        top_k: int,
    ) -> list[RagSearchResult]:
        if not allowed_document_ids:
            return []

        name = collection_name(organization_id)
        if not self.client.collection_exists(name):
            return []

        query_filter = self._allowed_documents_filter(
            allowed_document_ids,
            organization_id,
            extra=[
                models.FieldCondition(
                    key="text",
                    match=models.MatchText(text=query),
                )
            ],
        )
        points, _ = self.client.scroll(
            collection_name=name,
            scroll_filter=query_filter,
            limit=top_k,
            with_payload=True,
            with_vectors=False,
        )

        return [self._point_to_result(point, default_score=1.0) for point in points]

    def count_vectors(self, organization_id: str) -> int | None:
        name = collection_name(organization_id)
        if not self.client.collection_exists(name):
            return 0

        return self.client.count(collection_name=name, exact=False).count

    def _allowed_documents_filter(
        self,
        allowed_document_ids: list[str],
        organization_id: str,
        extra: list[models.FieldCondition] | None = None,
    ) -> models.Filter:
        return models.Filter(
            must=[
                models.FieldCondition(
                    key="document_id",
                    match=models.MatchAny(any=allowed_document_ids),
                ),
                models.FieldCondition(
                    key="organization_id",
                    match=models.MatchValue(value=organization_id),
                ),
                models.FieldCondition(
                    key="status",
                    match=models.MatchValue(value="ACTIVE"),
                ),
                *(extra or []),
            ]
        )

    def _create_payload_index(
        self,
        collection_name_value: str,
        field_name: str,
        field_schema: models.PayloadSchemaType | models.TextIndexParams,
    ) -> None:
        try:
            self.client.create_payload_index(
                collection_name=collection_name_value,
                field_name=field_name,
                field_schema=field_schema,
            )
        except Exception:
            # Index creation is best-effort and idempotent across Qdrant versions.
            return

    def _point_to_result(self, point: object, default_score: float | None = None) -> RagSearchResult:
        payload = getattr(point, "payload", {}) or {}
        score = getattr(point, "score", default_score if default_score is not None else 0.0)

        return RagSearchResult(
            score=float(score or 0.0),
            text=str(payload.get("text") or ""),
            document_id=str(payload.get("document_id") or ""),
            document_name=str(payload.get("document_name") or "Document"),
            file_type=payload.get("file_type"),
            chunk_index=int(payload.get("chunk_index") or 0),
            version_number=int(payload.get("version_number") or 1),
            metadata={
                key: value
                for key, value in payload.items()
                if key not in {"text", "document_id", "document_name"}
            },
        )
