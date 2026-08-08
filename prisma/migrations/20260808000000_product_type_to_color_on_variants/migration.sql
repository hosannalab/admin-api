-- Rename ProductType catalog table to Color
ALTER TABLE "ProductType" RENAME TO "Color";

-- Remove color/type from product level (colors live on variants now)
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_productTypeId_fkey";
DROP INDEX IF EXISTS "Product_productTypeId_idx";
ALTER TABLE "Product" DROP COLUMN IF EXISTS "productTypeId";

-- Add color to variants
ALTER TABLE "ProductVariant" ADD COLUMN "colorId" TEXT;

-- Backfill a default color per company for any existing variants
INSERT INTO "Color" ("id", "companyId", "name", "isActive", "createdAt", "updatedAt")
SELECT
  'clr_default_' || c."id",
  c."id",
  'Estándar',
  true,
  NOW(),
  NOW()
FROM "Company" c
WHERE NOT EXISTS (
  SELECT 1 FROM "Color" col
  WHERE col."companyId" = c."id" AND col."name" = 'Estándar'
);

UPDATE "ProductVariant" pv
SET "colorId" = (
  SELECT col."id"
  FROM "Color" col
  WHERE col."companyId" = pv."companyId" AND col."name" = 'Estándar'
  LIMIT 1
)
WHERE pv."colorId" IS NULL;

ALTER TABLE "ProductVariant" ALTER COLUMN "colorId" SET NOT NULL;

ALTER TABLE "ProductVariant" DROP CONSTRAINT IF EXISTS "ProductVariant_companyId_productId_sizeId_key";
CREATE UNIQUE INDEX "ProductVariant_companyId_productId_colorId_sizeId_key"
  ON "ProductVariant"("companyId", "productId", "colorId", "sizeId");

CREATE INDEX "ProductVariant_colorId_idx" ON "ProductVariant"("colorId");

ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_colorId_fkey"
  FOREIGN KEY ("colorId") REFERENCES "Color"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
