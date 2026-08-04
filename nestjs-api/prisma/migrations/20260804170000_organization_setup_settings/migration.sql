CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

ALTER TABLE "organizations"
ADD COLUMN "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX "organizations_status_idx" ON "organizations"("status");
