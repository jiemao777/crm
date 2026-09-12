DROP INDEX IF EXISTS "zohoMailboxFolder_mailboxId_kind_key";

ALTER TYPE "ZohoMailboxFolderKind" ADD VALUE IF NOT EXISTS 'OTHER';

CREATE UNIQUE INDEX "zohoMailboxFolder_mailboxId_path_key" ON "zohoMailboxFolder"("mailboxId", "path");

CREATE INDEX "zohoMailboxFolder_mailboxId_kind_idx" ON "zohoMailboxFolder"("mailboxId", "kind");
