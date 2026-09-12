-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('DEPOSIT', 'BALANCE', 'INSTALLMENT');

-- DropIndex
DROP INDEX "deal_expectedCloseDate_idx";

-- AlterTable
ALTER TABLE "quotation" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'INSTALLMENT',
    "amount" DECIMAL(14,2) NOT NULL,
    "expectedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "reference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_orderId_idx" ON "payment"("orderId");

-- CreateIndex
CREATE INDEX "payment_expectedAt_idx" ON "payment"("expectedAt");

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "salesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
