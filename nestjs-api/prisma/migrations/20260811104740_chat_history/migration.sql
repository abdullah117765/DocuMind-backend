-- AlterTable
ALTER TABLE "rag_chat_message_sources" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "rag_chat_messages" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "rag_chat_sessions" ALTER COLUMN "id" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "rag_chat_sessions_organization_id_created_by_user_id_deleted_at" RENAME TO "rag_chat_sessions_organization_id_created_by_user_id_delete_idx";
