CREATE TABLE "agentModelProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "protocol" TEXT NOT NULL,
    "baseUrl" TEXT,
    "encryptedApiKey" TEXT,
    "apiKeyHint" TEXT,
    "modelId" TEXT NOT NULL,
    "contextWindowTokens" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agentModelProvider_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "appSetting" ADD COLUMN "agentProviderId" TEXT;

CREATE UNIQUE INDEX "appSetting_agentProviderId_key" ON "appSetting"("agentProviderId");

ALTER TABLE "appSetting" ADD CONSTRAINT "appSetting_agentProviderId_fkey" FOREIGN KEY ("agentProviderId") REFERENCES "agentModelProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
