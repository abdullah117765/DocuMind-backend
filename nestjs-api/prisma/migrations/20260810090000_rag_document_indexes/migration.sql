-- Add RAG indexing status tracking for documents.

CREATE TYPE "DocumentRagIndexStatus" AS ENUM (
  'PENDING',
  'INDEXING',
  'INDEXED',
  'FAILED',
  'NO_CONTENT'
);

CREATE TABLE "document_rag_indexes" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "version_id" UUID,
  "version_number" INTEGER NOT NULL,
  "status" "DocumentRagIndexStatus" NOT NULL DEFAULT 'PENDING',
  "chunks_count" INTEGER NOT NULL DEFAULT 0,
  "embedding_model" VARCHAR(120) NOT NULL,
  "error_message" TEXT,
  "indexed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "document_rag_indexes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_rag_indexes_document_id_key"
ON "document_rag_indexes"("document_id");

CREATE INDEX "document_rag_indexes_organization_id_status_idx"
ON "document_rag_indexes"("organization_id", "status");

CREATE INDEX "document_rag_indexes_document_id_version_number_idx"
ON "document_rag_indexes"("document_id", "version_number");

ALTER TABLE "document_rag_indexes"
ADD CONSTRAINT "document_rag_indexes_document_id_fkey"
FOREIGN KEY ("document_id")
REFERENCES "documents"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "document_rag_indexes"
ADD CONSTRAINT "document_rag_indexes_organization_id_fkey"
FOREIGN KEY ("organization_id")
REFERENCES "organizations"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
