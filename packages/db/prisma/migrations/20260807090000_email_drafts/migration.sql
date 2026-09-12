CREATE TYPE "EmailDraftStatus" AS ENUM ('DRAFT', 'SENDING', 'FAILED', 'SENT');

CREATE TABLE "emailDraft" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT,
    "inReplyTo" TEXT,
    "references" TEXT,
    "to" JSONB NOT NULL,
    "cc" JSONB NOT NULL,
    "bcc" JSONB NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "status" "EmailDraftStatus" NOT NULL DEFAULT 'DRAFT',
    "lastError" TEXT,
    "sentMessageId" TEXT,
    "sentFrom" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "emailDraft_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "emailDraftAttachment" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "emailDraftAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "emailDraft_userId_updatedAt_idx" ON "emailDraft"("userId", "updatedAt");
CREATE INDEX "emailDraft_threadId_idx" ON "emailDraft"("threadId");
CREATE UNIQUE INDEX "emailDraft_sentMessageId_key" ON "emailDraft"("sentMessageId");
CREATE INDEX "emailDraftAttachment_draftId_idx" ON "emailDraftAttachment"("draftId");

ALTER TABLE "emailDraft" ADD CONSTRAINT "emailDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "emailDraft" ADD CONSTRAINT "emailDraft_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "emailThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "emailDraftAttachment" ADD CONSTRAINT "emailDraftAttachment_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "emailDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
