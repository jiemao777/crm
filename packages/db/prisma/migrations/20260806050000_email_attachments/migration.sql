CREATE TABLE "emailAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "content" BYTEA,
    "contentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "emailAttachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "emailAttachment_messageId_idx" ON "emailAttachment"("messageId");

ALTER TABLE "emailAttachment" ADD CONSTRAINT "emailAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "emailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
