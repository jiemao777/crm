ALTER TABLE "agentTask"
ADD COLUMN "emailThreadId" TEXT,
ADD COLUMN "userId" TEXT,
ADD COLUMN "allowCreate" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "agentTask_emailThreadId_idx" ON "agentTask"("emailThreadId");
CREATE INDEX "agentTask_userId_idx" ON "agentTask"("userId");

ALTER TABLE "agentTask"
ADD CONSTRAINT "agentTask_emailThreadId_fkey"
FOREIGN KEY ("emailThreadId") REFERENCES "emailThread"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agentTask"
ADD CONSTRAINT "agentTask_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "user"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
