CREATE TYPE "KnowledgeBaseStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "knowledge_bases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "normalized_name" VARCHAR(120) NOT NULL,
  "slug" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "status" "KnowledgeBaseStatus" NOT NULL DEFAULT 'ACTIVE',
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "created_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "knowledge_bases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_base_folders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "knowledge_base_id" UUID NOT NULL,
  "parent_id" UUID,
  "name" VARCHAR(120) NOT NULL,
  "normalized_name" VARCHAR(120) NOT NULL,
  "slug" VARCHAR(120) NOT NULL,
  "created_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "knowledge_base_folders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_base_collections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "knowledge_base_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "normalized_name" VARCHAR(120) NOT NULL,
  "slug" VARCHAR(120) NOT NULL,
  "description" VARCHAR(500),
  "created_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "knowledge_base_collections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_base_categories" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "normalized_name" VARCHAR(80) NOT NULL,
  "slug" VARCHAR(80) NOT NULL,
  "created_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "knowledge_base_categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_base_tags" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  "normalized_name" VARCHAR(60) NOT NULL,
  "slug" VARCHAR(60) NOT NULL,
  "created_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "knowledge_base_tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_knowledge_bases" (
  "document_id" UUID NOT NULL,
  "knowledge_base_id" UUID NOT NULL,
  "folder_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_knowledge_bases_pkey" PRIMARY KEY ("document_id", "knowledge_base_id")
);

CREATE TABLE "document_collections" (
  "document_id" UUID NOT NULL,
  "collection_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_collections_pkey" PRIMARY KEY ("document_id", "collection_id")
);

CREATE TABLE "document_categories" (
  "document_id" UUID NOT NULL,
  "category_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_categories_pkey" PRIMARY KEY ("document_id", "category_id")
);

CREATE TABLE "document_tags" (
  "document_id" UUID NOT NULL,
  "tag_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "document_tags_pkey" PRIMARY KEY ("document_id", "tag_id")
);

CREATE UNIQUE INDEX "knowledge_bases_organization_id_normalized_name_key"
  ON "knowledge_bases"("organization_id", "normalized_name");

CREATE UNIQUE INDEX "knowledge_bases_organization_id_slug_key"
  ON "knowledge_bases"("organization_id", "slug");

CREATE INDEX "knowledge_bases_organization_id_status_updated_at_idx"
  ON "knowledge_bases"("organization_id", "status", "updated_at");

CREATE INDEX "knowledge_bases_organization_id_is_default_idx"
  ON "knowledge_bases"("organization_id", "is_default");

CREATE UNIQUE INDEX "knowledge_base_folders_knowledge_base_id_parent_id_normalized_name_key"
  ON "knowledge_base_folders"("knowledge_base_id", "parent_id", "normalized_name");

CREATE INDEX "knowledge_base_folders_organization_id_knowledge_base_id_idx"
  ON "knowledge_base_folders"("organization_id", "knowledge_base_id");

CREATE INDEX "knowledge_base_folders_parent_id_idx"
  ON "knowledge_base_folders"("parent_id");

CREATE UNIQUE INDEX "knowledge_base_collections_knowledge_base_id_normalized_name_key"
  ON "knowledge_base_collections"("knowledge_base_id", "normalized_name");

CREATE INDEX "knowledge_base_collections_organization_id_knowledge_base_id_idx"
  ON "knowledge_base_collections"("organization_id", "knowledge_base_id");

CREATE UNIQUE INDEX "knowledge_base_categories_organization_id_normalized_name_key"
  ON "knowledge_base_categories"("organization_id", "normalized_name");

CREATE INDEX "knowledge_base_categories_organization_id_updated_at_idx"
  ON "knowledge_base_categories"("organization_id", "updated_at");

CREATE UNIQUE INDEX "knowledge_base_tags_organization_id_normalized_name_key"
  ON "knowledge_base_tags"("organization_id", "normalized_name");

CREATE INDEX "knowledge_base_tags_organization_id_updated_at_idx"
  ON "knowledge_base_tags"("organization_id", "updated_at");

CREATE INDEX "document_knowledge_bases_knowledge_base_id_idx"
  ON "document_knowledge_bases"("knowledge_base_id");

CREATE INDEX "document_knowledge_bases_folder_id_idx"
  ON "document_knowledge_bases"("folder_id");

CREATE INDEX "document_collections_collection_id_idx"
  ON "document_collections"("collection_id");

CREATE INDEX "document_categories_category_id_idx"
  ON "document_categories"("category_id");

CREATE INDEX "document_tags_tag_id_idx"
  ON "document_tags"("tag_id");

ALTER TABLE "knowledge_bases"
  ADD CONSTRAINT "knowledge_bases_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_bases"
  ADD CONSTRAINT "knowledge_bases_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "knowledge_base_folders"
  ADD CONSTRAINT "knowledge_base_folders_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_base_folders"
  ADD CONSTRAINT "knowledge_base_folders_knowledge_base_id_fkey"
  FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_base_folders"
  ADD CONSTRAINT "knowledge_base_folders_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "knowledge_base_folders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "knowledge_base_folders"
  ADD CONSTRAINT "knowledge_base_folders_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "knowledge_base_collections"
  ADD CONSTRAINT "knowledge_base_collections_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_base_collections"
  ADD CONSTRAINT "knowledge_base_collections_knowledge_base_id_fkey"
  FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_base_collections"
  ADD CONSTRAINT "knowledge_base_collections_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "knowledge_base_categories"
  ADD CONSTRAINT "knowledge_base_categories_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_base_categories"
  ADD CONSTRAINT "knowledge_base_categories_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "knowledge_base_tags"
  ADD CONSTRAINT "knowledge_base_tags_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "knowledge_base_tags"
  ADD CONSTRAINT "knowledge_base_tags_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "document_knowledge_bases"
  ADD CONSTRAINT "document_knowledge_bases_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_knowledge_bases"
  ADD CONSTRAINT "document_knowledge_bases_knowledge_base_id_fkey"
  FOREIGN KEY ("knowledge_base_id") REFERENCES "knowledge_bases"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_knowledge_bases"
  ADD CONSTRAINT "document_knowledge_bases_folder_id_fkey"
  FOREIGN KEY ("folder_id") REFERENCES "knowledge_base_folders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "document_collections"
  ADD CONSTRAINT "document_collections_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_collections"
  ADD CONSTRAINT "document_collections_collection_id_fkey"
  FOREIGN KEY ("collection_id") REFERENCES "knowledge_base_collections"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_categories"
  ADD CONSTRAINT "document_categories_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_categories"
  ADD CONSTRAINT "document_categories_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "knowledge_base_categories"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_tags"
  ADD CONSTRAINT "document_tags_document_id_fkey"
  FOREIGN KEY ("document_id") REFERENCES "documents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "document_tags"
  ADD CONSTRAINT "document_tags_tag_id_fkey"
  FOREIGN KEY ("tag_id") REFERENCES "knowledge_base_tags"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "knowledge_bases" (
  "organization_id",
  "name",
  "normalized_name",
  "slug",
  "description",
  "is_default",
  "created_by_user_id",
  "updated_at"
)
SELECT
  "id",
  'Default Knowledge Base',
  'default knowledge base',
  'default-knowledge-base',
  'Default workspace for existing organization documents.',
  true,
  "created_by_user_id",
  CURRENT_TIMESTAMP
FROM "organizations"
ON CONFLICT ("organization_id", "normalized_name") DO NOTHING;

INSERT INTO "document_knowledge_bases" ("document_id", "knowledge_base_id")
SELECT d."id", kb."id"
FROM "documents" d
JOIN "knowledge_bases" kb
  ON kb."organization_id" = d."organization_id"
 AND kb."is_default" = true
ON CONFLICT ("document_id", "knowledge_base_id") DO NOTHING;
