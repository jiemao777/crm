-- AlterTable
ALTER TABLE "agentTask" ADD COLUMN     "dealId" TEXT;

-- AlterTable
ALTER TABLE "deal" ADD COLUMN     "forecastContext" TEXT,
ADD COLUMN     "forecastContextManual" TEXT,
ADD COLUMN     "forecastUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "score" INTEGER,
ADD COLUMN     "scoreSummary" TEXT,
ADD COLUMN     "scoredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "agentTask_dealId_idx" ON "agentTask"("dealId");

-- AddForeignKey
ALTER TABLE "agentTask" ADD CONSTRAINT "agentTask_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
