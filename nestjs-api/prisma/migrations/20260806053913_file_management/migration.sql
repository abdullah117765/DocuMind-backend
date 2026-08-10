-- RenameIndex
--
-- This migration may be replayed against a fresh shadow database before the
-- document upload session indexes exist. Keep it conditional so Prisma Migrate
-- can rebuild the migration history cleanly.
DO $$
BEGIN
  IF to_regclass('public.document_upload_sessions_created_by_user_id_status_created_at_i') IS NOT NULL
    AND to_regclass('public.document_upload_sessions_created_by_user_id_status_created__idx') IS NULL
  THEN
    ALTER INDEX "document_upload_sessions_created_by_user_id_status_created_at_i"
      RENAME TO "document_upload_sessions_created_by_user_id_status_created__idx";
  END IF;
END $$;
