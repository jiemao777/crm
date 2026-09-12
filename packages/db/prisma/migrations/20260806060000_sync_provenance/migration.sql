CREATE TABLE "emailMessageSync" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "emailMessageSync_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "calendarEventSync" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "calendarEventSync_pkey" PRIMARY KEY ("id")
);

INSERT INTO "emailMessageSync" ("id", "messageId", "userId", "source")
SELECT
    md5(message."id" || ':' || message."syncedByUserId" || ':' || CASE WHEN message."zohoMessageId" IS NOT NULL THEN 'zoho' ELSE 'gmail' END),
    message."id",
    message."syncedByUserId",
    CASE WHEN message."zohoMessageId" IS NOT NULL THEN 'zoho' ELSE 'gmail' END
FROM "emailMessage" AS message
INNER JOIN "user" AS account ON account."id" = message."syncedByUserId"
WHERE message."syncedByUserId" IS NOT NULL;

INSERT INTO "calendarEventSync" ("id", "eventId", "userId")
SELECT
    md5(event."id" || ':' || event."syncedByUserId"),
    event."id",
    event."syncedByUserId"
FROM "calendarEvent" AS event
INNER JOIN "user" AS account ON account."id" = event."syncedByUserId"
WHERE event."syncedByUserId" IS NOT NULL;

CREATE UNIQUE INDEX "emailMessageSync_messageId_userId_source_key" ON "emailMessageSync"("messageId", "userId", "source");
CREATE INDEX "emailMessageSync_userId_source_idx" ON "emailMessageSync"("userId", "source");
CREATE UNIQUE INDEX "calendarEventSync_eventId_userId_key" ON "calendarEventSync"("eventId", "userId");
CREATE INDEX "calendarEventSync_userId_idx" ON "calendarEventSync"("userId");

ALTER TABLE "emailMessageSync" ADD CONSTRAINT "emailMessageSync_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "emailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "emailMessageSync" ADD CONSTRAINT "emailMessageSync_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendarEventSync" ADD CONSTRAINT "calendarEventSync_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "calendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "calendarEventSync" ADD CONSTRAINT "calendarEventSync_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
