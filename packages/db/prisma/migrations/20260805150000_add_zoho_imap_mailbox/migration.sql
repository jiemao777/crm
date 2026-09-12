CREATE TYPE "ZohoMailboxFolderKind" AS ENUM ('INBOX', 'SENT');

ALTER TABLE "emailMessage"
    ADD COLUMN "zohoMessageId" TEXT,
    ADD COLUMN "zohoMailboxFolderId" TEXT;

CREATE TABLE "zohoMailbox" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "host" TEXT NOT NULL DEFAULT 'imap.zoho.com',
    "port" INTEGER NOT NULL DEFAULT 993,
    "secure" BOOLEAN NOT NULL DEFAULT true,
    "encryptedPassword" TEXT NOT NULL,
    "status" "GoogleSyncStatus" NOT NULL DEFAULT 'IDLE',
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "retryAfter" TIMESTAMP(3),
    "autoCreate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zohoMailbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "zohoMailboxFolder" (
    "id" TEXT NOT NULL,
    "mailboxId" TEXT NOT NULL,
    "kind" "ZohoMailboxFolderKind" NOT NULL,
    "path" TEXT NOT NULL,
    "uidValidity" TEXT,
    "lastUid" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "zohoMailboxFolder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "zohoMailbox_userId_key" ON "zohoMailbox"("userId");
CREATE INDEX "zohoMailbox_status_idx" ON "zohoMailbox"("status");
CREATE UNIQUE INDEX "zohoMailboxFolder_mailboxId_kind_key" ON "zohoMailboxFolder"("mailboxId", "kind");
CREATE INDEX "emailMessage_zohoMailboxFolderId_idx" ON "emailMessage"("zohoMailboxFolderId");

ALTER TABLE "zohoMailbox"
    ADD CONSTRAINT "zohoMailbox_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "zohoMailboxFolder"
    ADD CONSTRAINT "zohoMailboxFolder_mailboxId_fkey"
    FOREIGN KEY ("mailboxId") REFERENCES "zohoMailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "emailMessage"
    ADD CONSTRAINT "emailMessage_zohoMailboxFolderId_fkey"
    FOREIGN KEY ("zohoMailboxFolderId") REFERENCES "zohoMailboxFolder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
