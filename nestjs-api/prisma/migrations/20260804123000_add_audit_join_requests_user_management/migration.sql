CREATE TYPE "JoinRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELED');

ALTER TABLE "users"
  ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "deactivated_at" TIMESTAMP(3);

ALTER TABLE "organizations"
  ADD COLUMN "allow_join_requests" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "organization_invites"
  ADD COLUMN "last_sent_at" TIMESTAMP(3),
  ADD COLUMN "last_send_failure_at" TIMESTAMP(3),
  ADD COLUMN "last_send_failure_reason" VARCHAR(500);

CREATE TABLE "join_requests" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "organization_id" UUID NOT NULL,
  "message" VARCHAR(1000),
  "status" "JoinRequestStatus" NOT NULL DEFAULT 'PENDING',
  "reviewed_by_user_id" UUID,
  "rejection_reason" VARCHAR(1000),
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "join_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" UUID NOT NULL,
  "actor_user_id" UUID,
  "organization_id" UUID,
  "action" VARCHAR(160) NOT NULL,
  "method" VARCHAR(12) NOT NULL,
  "path" VARCHAR(500) NOT NULL,
  "resource" VARCHAR(120) NOT NULL,
  "status_code" INTEGER,
  "ip_address" VARCHAR(45),
  "user_agent" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "join_requests_user_id_status_created_at_idx"
  ON "join_requests"("user_id", "status", "created_at");

CREATE INDEX "join_requests_organization_id_status_created_at_idx"
  ON "join_requests"("organization_id", "status", "created_at");

CREATE INDEX "audit_logs_actor_user_id_created_at_idx"
  ON "audit_logs"("actor_user_id", "created_at");

CREATE INDEX "audit_logs_organization_id_created_at_idx"
  ON "audit_logs"("organization_id", "created_at");

CREATE INDEX "audit_logs_action_created_at_idx"
  ON "audit_logs"("action", "created_at");

CREATE INDEX "audit_logs_created_at_idx"
  ON "audit_logs"("created_at");

ALTER TABLE "join_requests"
  ADD CONSTRAINT "join_requests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "join_requests"
  ADD CONSTRAINT "join_requests_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "join_requests"
  ADD CONSTRAINT "join_requests_reviewed_by_user_id_fkey"
  FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
