CREATE TYPE "DocumentStatus" AS ENUM (
  'ACTIVE',
  'SOFT_DELETED_BY_USER',
  'SOFT_DELETED_BY_ORG',
  'PURGED'
);

CREATE TYPE "DocumentAccessLevel" AS ENUM ('PREVIEW');

CREATE TYPE "DocumentUploadSessionStatus" AS ENUM (
  'PENDING',
  'COMMITTED',
  'CANCELED',
  'EXPIRED'
);

CREATE TYPE "DocumentStagedFileStatus" AS ENUM (
  'READY',
  'REJECTED',
  'REMOVED',
  'COMMITTED'
);

CREATE TABLE "documents" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "original_filename" VARCHAR(255) NOT NULL,
  "extension" VARCHAR(16) NOT NULL,
  "mime_type" VARCHAR(120) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "checksum_sha256" VARCHAR(64) NOT NULL,
  "storage_bucket" VARCHAR(80) NOT NULL,
  "storage_key" VARCHAR(500) NOT NULL,
  "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_by_user_id" UUID NOT NULL,
  "user_deleted_by_user_id" UUID,
  "user_deleted_at" TIMESTAMP(3),
  "org_deleted_by_user_id" UUID,
  "org_deleted_at" TIMESTAMP(3),
  "restored_by_user_id" UUID,
  "restored_at" TIMESTAMP(3),
  "purged_by_user_id" UUID,
  "purged_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_versions" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "version_number" INTEGER NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "original_filename" VARCHAR(255) NOT NULL,
  "extension" VARCHAR(16) NOT NULL,
  "mime_type" VARCHAR(120) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "checksum_sha256" VARCHAR(64) NOT NULL,
  "storage_bucket" VARCHAR(80) NOT NULL,
  "storage_key" VARCHAR(500) NOT NULL,
  "metadata" JSONB,
  "preview" JSONB,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_access" (
  "id" UUID NOT NULL,
  "document_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "access_level" "DocumentAccessLevel" NOT NULL DEFAULT 'PREVIEW',
  "granted_by_user_id" UUID NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_access_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_upload_sessions" (
  "id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "created_by_user_id" UUID NOT NULL,
  "status" "DocumentUploadSessionStatus" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "committed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "document_upload_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_upload_staged_files" (
  "id" UUID NOT NULL,
  "upload_session_id" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "original_filename" VARCHAR(255) NOT NULL,
  "extension" VARCHAR(16) NOT NULL,
  "mime_type" VARCHAR(120) NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "checksum_sha256" VARCHAR(64) NOT NULL,
  "storage_bucket" VARCHAR(80) NOT NULL,
  "storage_key" VARCHAR(500) NOT NULL,
  "metadata" JSONB,
  "preview" JSONB,
  "status" "DocumentStagedFileStatus" NOT NULL DEFAULT 'READY',
  "rejection_reason" VARCHAR(500),
  "source_archive_name" VARCHAR(255),
  "source_archive_path" VARCHAR(500),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "document_upload_staged_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "document_versions_document_id_version_number_key"
  ON "document_versions"("document_id", "version_number");

CREATE INDEX "documents_organization_id_status_updated_at_idx"
  ON "documents"("organization_id", "status", "updated_at");
CREATE INDEX "documents_created_by_user_id_status_updated_at_idx"
  ON "documents"("created_by_user_id", "status", "updated_at");
CREATE INDEX "documents_checksum_sha256_idx"
  ON "documents"("checksum_sha256");
CREATE INDEX "document_versions_organization_id_created_at_idx"
  ON "document_versions"("organization_id", "created_at");
CREATE INDEX "document_versions_created_by_user_id_created_at_idx"
  ON "document_versions"("created_by_user_id", "created_at");
CREATE INDEX "document_access_document_id_revoked_at_idx"
  ON "document_access"("document_id", "revoked_at");
CREATE INDEX "document_access_user_id_revoked_at_idx"
  ON "document_access"("user_id", "revoked_at");
CREATE INDEX "document_upload_sessions_organization_id_status_created_at_idx"
  ON "document_upload_sessions"("organization_id", "status", "created_at");
CREATE INDEX "document_upload_sessions_created_by_user_id_status_created__idx"
  ON "document_upload_sessions"("created_by_user_id", "status", "created_at");
CREATE INDEX "document_upload_staged_files_upload_session_id_status_idx"
  ON "document_upload_staged_files"("upload_session_id", "status");

ALTER TABLE "documents"
  ADD CONSTRAINT "documents_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_user_deleted_by_user_id_fkey"
  FOREIGN KEY ("user_deleted_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_org_deleted_by_user_id_fkey"
  FOREIGN KEY ("org_deleted_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_restored_by_user_id_fkey"
  FOREIGN KEY ("restored_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "documents"
  ADD CONSTRAINT "documents_purged_by_user_id_fkey"
  FOREIGN KEY ("purged_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "document_versions"
  ADD CONSTRAINT "document_versions_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_versions"
  ADD CONSTRAINT "document_versions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_access"
  ADD CONSTRAINT "document_access_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_access"
  ADD CONSTRAINT "document_access_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_access"
  ADD CONSTRAINT "document_access_granted_by_user_id_fkey"
  FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "document_upload_sessions"
  ADD CONSTRAINT "document_upload_sessions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_upload_sessions"
  ADD CONSTRAINT "document_upload_sessions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_upload_staged_files"
  ADD CONSTRAINT "document_upload_staged_files_upload_session_id_fkey"
  FOREIGN KEY ("upload_session_id") REFERENCES "document_upload_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
