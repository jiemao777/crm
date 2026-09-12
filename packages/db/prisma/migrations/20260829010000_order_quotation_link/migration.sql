-- AlterTable
ALTER TABLE "salesOrder" ADD COLUMN "quotationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "salesOrder_quotationId_key" ON "salesOrder"("quotationId");

-- AddForeignKey
ALTER TABLE "salesOrder" ADD CONSTRAINT "salesOrder_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
