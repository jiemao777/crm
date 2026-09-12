CREATE TYPE "CustomerType" AS ENUM ('LEAD', 'BUYER', 'DISTRIBUTOR', 'AGENT', 'CUSTOMER');
CREATE TYPE "Incoterm" AS ENUM ('EXW', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP', 'OTHER');
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED');

ALTER TABLE "company"
  ADD COLUMN "customerType" "CustomerType" NOT NULL DEFAULT 'LEAD',
  ADD COLUMN "customerLevel" TEXT,
  ADD COLUMN "leadSource" TEXT,
  ADD COLUMN "productInterest" TEXT,
  ADD COLUMN "targetMarkets" TEXT,
  ADD COLUMN "language" TEXT,
  ADD COLUMN "timezone" TEXT;

CREATE INDEX "company_customerType_idx" ON "company"("customerType");

ALTER TYPE "DealStage" RENAME TO "DealStage_old";
CREATE TYPE "DealStage" AS ENUM ('NEW_INQUIRY', 'CONTACTED', 'REPLIED', 'RFQ_RECEIVED', 'QUOTED', 'SAMPLE', 'NEGOTIATING', 'PROFORMA_INVOICE', 'WON', 'LOST', 'UNQUALIFIED', 'DEMO_BOOKED', 'QUALIFIED_TO_BUY', 'DECISION_MAKER_BOUGHT_IN', 'CONTRACT_SENT', 'CLOSED_WON', 'CLOSED_LOST', 'UNQUALIFIED_TO_BUY');

ALTER TABLE "deal"
  ALTER COLUMN "stage" DROP DEFAULT,
  ALTER COLUMN "stage" TYPE "DealStage" USING (
    CASE "stage"::text
      WHEN 'DEMO_BOOKED' THEN 'NEW_INQUIRY'
      WHEN 'QUALIFIED_TO_BUY' THEN 'RFQ_RECEIVED'
      WHEN 'DECISION_MAKER_BOUGHT_IN' THEN 'NEGOTIATING'
      WHEN 'CONTRACT_SENT' THEN 'PROFORMA_INVOICE'
      WHEN 'CLOSED_WON' THEN 'WON'
      WHEN 'CLOSED_LOST' THEN 'LOST'
      WHEN 'UNQUALIFIED_TO_BUY' THEN 'UNQUALIFIED'
    END::"DealStage"
  ),
  ALTER COLUMN "stage" SET DEFAULT 'NEW_INQUIRY';

DROP TYPE "DealStage_old";

ALTER TABLE "deal"
  ADD COLUMN "inquiryNo" TEXT,
  ADD COLUMN "inquiryReceivedAt" TIMESTAMP(3),
  ADD COLUMN "expectedOrderDate" TIMESTAMP(3),
  ADD COLUMN "requiredDeliveryDate" TIMESTAMP(3),
  ADD COLUMN "productSummary" TEXT,
  ADD COLUMN "specification" TEXT,
  ADD COLUMN "quantity" TEXT,
  ADD COLUMN "unit" TEXT,
  ADD COLUMN "targetPrice" DECIMAL(14,2),
  ADD COLUMN "incoterm" "Incoterm",
  ADD COLUMN "originPort" TEXT,
  ADD COLUMN "destinationPort" TEXT,
  ADD COLUMN "paymentTerms" TEXT,
  ADD COLUMN "quoteValidUntil" TIMESTAMP(3),
  ADD COLUMN "quotedAt" TIMESTAMP(3);

UPDATE "deal"
SET "inquiryReceivedAt" = "createdAt",
    "expectedOrderDate" = "expectedCloseDate"
WHERE "inquiryReceivedAt" IS NULL;

ALTER TABLE "deal"
  ALTER COLUMN "inquiryReceivedAt" SET NOT NULL,
  ALTER COLUMN "inquiryReceivedAt" SET DEFAULT CURRENT_TIMESTAMP;

UPDATE "deal"
SET "inquiryNo" = 'INQ-' || TO_CHAR("inquiryReceivedAt", 'YYYY') || '-' || UPPER(RIGHT("id", 6))
WHERE "inquiryNo" IS NULL;

CREATE UNIQUE INDEX "deal_inquiryNo_key" ON "deal"("inquiryNo");
CREATE INDEX "deal_expectedOrderDate_idx" ON "deal"("expectedOrderDate");

CREATE TABLE "quotation" (
  "id" TEXT NOT NULL,
  "quoteNumber" TEXT NOT NULL,
  "dealId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "incoterm" "Incoterm",
  "originPort" TEXT,
  "destinationPort" TEXT,
  "paymentTerms" TEXT,
  "leadTimeDays" INTEGER,
  "validUntil" TIMESTAMP(3),
  "notes" TEXT,
  "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "quotation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "quotationItem" (
  "id" TEXT NOT NULL,
  "quotationId" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "sku" TEXT,
  "specification" TEXT,
  "quantity" DECIMAL(14,3) NOT NULL,
  "unit" TEXT,
  "unitPrice" DECIMAL(14,2) NOT NULL,
  "lineTotal" DECIMAL(14,2) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "quotationItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "quotation_quoteNumber_key" ON "quotation"("quoteNumber");
CREATE UNIQUE INDEX "quotation_dealId_version_key" ON "quotation"("dealId", "version");
CREATE INDEX "quotation_dealId_status_idx" ON "quotation"("dealId", "status");
CREATE INDEX "quotation_validUntil_idx" ON "quotation"("validUntil");
CREATE INDEX "quotationItem_quotationId_sortOrder_idx" ON "quotationItem"("quotationId", "sortOrder");

ALTER TABLE "quotation"
  ADD CONSTRAINT "quotation_dealId_fkey"
  FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quotationItem"
  ADD CONSTRAINT "quotationItem_quotationId_fkey"
  FOREIGN KEY ("quotationId") REFERENCES "quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
