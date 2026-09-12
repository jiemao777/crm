CREATE TYPE "SampleStatus" AS ENUM ('REQUESTED', 'PREPARING', 'SHIPPED', 'DELIVERED', 'APPROVED', 'REJECTED');
CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED');

CREATE TABLE "sample" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "status" "SampleStatus" NOT NULL DEFAULT 'REQUESTED',
    "product" TEXT NOT NULL,
    "variant" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "shipTo" TEXT,
    "courier" TEXT,
    "trackingNo" TEXT,
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sample_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sample_dealId_idx" ON "sample"("dealId");
CREATE INDEX "sample_status_idx" ON "sample"("status");
ALTER TABLE "sample" ADD CONSTRAINT "sample_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "salesOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "incoterm" "Incoterm",
    "paymentTerms" TEXT,
    "productionStart" TIMESTAMP(3),
    "productionEnd" TIMESTAMP(3),
    "shipDate" TIMESTAMP(3),
    "deliveryDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "salesOrder_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "salesOrder_orderNumber_key" ON "salesOrder"("orderNumber");
CREATE INDEX "salesOrder_dealId_idx" ON "salesOrder"("dealId");
CREATE INDEX "salesOrder_status_idx" ON "salesOrder"("status");
ALTER TABLE "salesOrder" ADD CONSTRAINT "salesOrder_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "salesOrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sku" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "totalPrice" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "salesOrderItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "salesOrderItem_orderId_idx" ON "salesOrderItem"("orderId");
ALTER TABLE "salesOrderItem" ADD CONSTRAINT "salesOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "salesOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
