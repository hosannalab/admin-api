-- The color migration dropped a CONSTRAINT name, but this unique was created as an INDEX.
-- It blocked two colors from sharing the same size on one product.
DROP INDEX IF EXISTS "ProductVariant_companyId_productId_sizeId_key";
