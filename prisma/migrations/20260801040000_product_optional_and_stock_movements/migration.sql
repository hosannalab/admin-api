-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "StockMovementReason" AS ENUM (
  'INITIAL',
  'PURCHASE',
  'CUSTOMER_RETURN',
  'POSITIVE_ADJUSTMENT',
  'SALE',
  'SUPPLIER_RETURN',
  'DAMAGE',
  'NEGATIVE_ADJUSTMENT'
);

-- DropIndex
DROP INDEX IF EXISTS "Product_companyId_reference_productTypeId_key";

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "sportId" DROP NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "productTypeId" DROP NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "productModelId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Product_companyId_reference_key" ON "Product"("companyId", "reference");

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "reason" "StockMovementReason" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "stockBefore" INTEGER NOT NULL,
    "stockAfter" INTEGER NOT NULL,
    "note" TEXT,
    "reference" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockMovement_companyId_createdAt_idx" ON "StockMovement"("companyId", "createdAt");
CREATE INDEX "StockMovement_variantId_createdAt_idx" ON "StockMovement"("variantId", "createdAt");
CREATE INDEX "StockMovement_companyId_type_idx" ON "StockMovement"("companyId", "type");

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
