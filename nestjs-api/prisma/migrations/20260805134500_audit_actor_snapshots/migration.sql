ALTER TABLE "audit_logs"
  ADD COLUMN "actor_name" VARCHAR(150),
  ADD COLUMN "actor_email" VARCHAR(254);

UPDATE "audit_logs" AS audit_log
SET
  "actor_name" = COALESCE("actor"."name", "audit_log"."metadata" #>> '{actor,name}'),
  "actor_email" = COALESCE("actor"."email", "audit_log"."metadata" #>> '{actor,email}')
FROM "users" AS actor
WHERE "audit_log"."actor_user_id" = "actor"."id";

UPDATE "audit_logs"
SET
  "actor_name" = COALESCE("actor_name", "metadata" #>> '{actor,name}'),
  "actor_email" = COALESCE("actor_email", "metadata" #>> '{actor,email}')
WHERE "actor_name" IS NULL OR "actor_email" IS NULL;

CREATE INDEX "audit_logs_actor_email_created_at_idx"
  ON "audit_logs"("actor_email", "created_at");
