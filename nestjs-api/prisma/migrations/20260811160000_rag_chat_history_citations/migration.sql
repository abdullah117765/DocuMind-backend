CREATE TYPE "RagChatMessageRole" AS ENUM ('USER', 'ASSISTANT');

CREATE TABLE "rag_chat_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "rag_chat_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rag_chat_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "chat_session_id" UUID NOT NULL,
  "role" "RagChatMessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "summary" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rag_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rag_chat_message_sources" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "message_id" UUID NOT NULL,
  "document_id" UUID,
  "document_name" VARCHAR(255) NOT NULL,
  "file_type" VARCHAR(32),
  "version_number" INTEGER NOT NULL,
  "chunk_index" INTEGER NOT NULL,
  "page_number" INTEGER,
  "slide_number" INTEGER,
  "sheet_name" VARCHAR(120),
  "line_start" INTEGER,
  "line_end" INTEGER,
  "section_title" VARCHAR(255),
  "location_label" VARCHAR(255),
  "score" DOUBLE PRECISION,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rag_chat_message_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rag_chat_selected_documents" (
  "chat_session_id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rag_chat_selected_documents_pkey" PRIMARY KEY ("chat_session_id", "document_id")
);

CREATE INDEX "rag_chat_sessions_organization_id_created_by_user_id_deleted_at_updated_at_idx"
  ON "rag_chat_sessions"("organization_id", "created_by_user_id", "deleted_at", "updated_at");

CREATE INDEX "rag_chat_sessions_created_by_user_id_updated_at_idx"
  ON "rag_chat_sessions"("created_by_user_id", "updated_at");

CREATE INDEX "rag_chat_messages_chat_session_id_created_at_idx"
  ON "rag_chat_messages"("chat_session_id", "created_at");

CREATE INDEX "rag_chat_message_sources_message_id_idx"
  ON "rag_chat_message_sources"("message_id");

CREATE INDEX "rag_chat_message_sources_document_id_idx"
  ON "rag_chat_message_sources"("document_id");

CREATE INDEX "rag_chat_selected_documents_document_id_idx"
  ON "rag_chat_selected_documents"("document_id");

ALTER TABLE "rag_chat_sessions"
  ADD CONSTRAINT "rag_chat_sessions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rag_chat_sessions"
  ADD CONSTRAINT "rag_chat_sessions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rag_chat_messages"
  ADD CONSTRAINT "rag_chat_messages_chat_session_id_fkey"
  FOREIGN KEY ("chat_session_id") REFERENCES "rag_chat_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rag_chat_message_sources"
  ADD CONSTRAINT "rag_chat_message_sources_message_id_fkey"
  FOREIGN KEY ("message_id") REFERENCES "rag_chat_messages"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rag_chat_message_sources"
  ADD CONSTRAINT "rag_chat_message_sources_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "rag_chat_selected_documents"
  ADD CONSTRAINT "rag_chat_selected_documents_chat_session_id_fkey"
  FOREIGN KEY ("chat_session_id") REFERENCES "rag_chat_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rag_chat_selected_documents"
  ADD CONSTRAINT "rag_chat_selected_documents_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
