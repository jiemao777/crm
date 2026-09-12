CREATE TYPE "EmailThreadCategory" AS ENUM ('INQUIRY', 'PROMOTION', 'NOTIFICATION', 'OTHER');
ALTER TABLE "emailThread" ADD COLUMN "category" "EmailThreadCategory" NOT NULL DEFAULT 'OTHER';
