/**
 * Import inventory rows from "BASE DE DATOS + STOCK.xlsx" into PostgreSQL.
 *
 * Usage:
 *   npm run prisma:import-excel
 *   npm run prisma:import-excel -- --file "../Excel/BASE DE DATOS + STOCK.xlsx"
 *   npm run prisma:import-excel -- --dry-run
 *   npm run prisma:import-excel -- --update-existing
 */

const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../.env'),
});

const XLSX = require('xlsx');
const { PrismaPg } = require('@prisma/adapter-pg');
const {
  PrismaClient,
  ProductStatus,
  StockMovementReason,
  StockMovementType,
} = require('@prisma/client');
const { Pool } = require('pg');

const COMPANY_EXTERNAL_ID = 'cmp_spot_deportivo';
const DEFAULT_EXCEL_FILE = path.resolve(
  __dirname,
  '../../Excel/BASE DE DATOS + STOCK.xlsx',
);

const STOREFRONT_CATEGORIES = [
  'JERSEY',
  'HOMBRE',
  'MUJER',
  'CALZADO',
  'ACCESORIOS',
  'NUEVAS COLECCIONES',
];

const WOMEN_PRODUCT_TYPES = new Set([
  'BLUSA',
  'CONJUNTO',
  'LICRA W',
  'ENTERIZO',
]);

const FOOTWEAR_PRODUCT_TYPES = new Set(['TENIS', 'SANDALIAS']);

const ACCESSORY_PRODUCT_TYPES = new Set(['GORRA', 'MEDIAS', 'VICERA']);

const NON_SPORT_VALUES = new Set([
  '',
  'MUJER',
  'CORTA',
  'LARGA',
  'MANGA LARGA',
  'UNISEX',
  'FRANELA NBA',
]);

const HEADER_ALIASES = {
  image: ['image'],
  itemNo: ['no'],
  reference: ['referencia'],
  description: ['descripcion', 'descripción'],
  productType: ['categoria'],
  sport: ['deporte'],
  brand: ['equipo | marca', 'equipo|marca', 'marca'],
  size: ['size'],
  model: ['modelo'],
  variantType: ['tipo'],
  status: ['estatus'],
  salePrice: ['precio venta', 'precio'],
  imageUrl: ['imagen'],
  stock: ['inventario', 'stock'],
};

function parseArgs(argv) {
  const options = {
    file: DEFAULT_EXCEL_FILE,
    dryRun: false,
    updateExisting: false,
    companyExternalId: COMPANY_EXTERNAL_ID,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--update-existing') options.updateExisting = true;
    else if (arg === '--file') {
      options.file = path.resolve(argv[index + 1] || DEFAULT_EXCEL_FILE);
      index += 1;
    } else if (arg === '--company') {
      options.companyExternalId = argv[index + 1] || COMPANY_EXTERNAL_ID;
      index += 1;
    }
  }

  return options;
}

function normalize(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(value) {
  return normalize(value).toUpperCase();
}

function parsePrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number(value.toFixed(2));
  }

  const cleaned = normalize(value)
    .replace(/[^0-9.,-]/g, '')
    .replace(/,/g, '');

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function parseStock(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  const parsed = Number(normalize(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function parseStatus(value) {
  return normalizeKey(value) === 'ACTIVO'
    ? ProductStatus.ACTIVE
    : ProductStatus.INACTIVE;
}

function sanitizeImageUrl(value) {
  const text = normalize(value);
  if (!text || text === '#VALUE!') return null;
  if (/^https?:\/\//i.test(text)) return text;
  return null;
}

function resolveHeaderIndex(headers) {
  const normalizedHeaders = headers.map((header) => normalizeKey(header));
  const indexByField = {};

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const aliasKeys = aliases.map((alias) => normalizeKey(alias));
    const matchIndex = normalizedHeaders.findIndex((header) =>
      aliasKeys.includes(header),
    );
    if (matchIndex >= 0) indexByField[field] = matchIndex;
  }

  const required = [
    'itemNo',
    'reference',
    'description',
    'productType',
    'brand',
    'size',
    'variantType',
    'status',
    'salePrice',
    'stock',
  ];

  const missing = required.filter((field) => indexByField[field] === undefined);
  if (missing.length) {
    throw new Error(
      `Excel header is missing required columns: ${missing.join(', ')}`,
    );
  }

  return indexByField;
}

function mapRow(values, headerIndex) {
  const get = (field) => normalize(values[headerIndex[field]]);

  return {
    itemNo: get('itemNo'),
    reference: get('reference'),
    description: get('description'),
    productType: get('productType'),
    sport: get('sport'),
    brand: get('brand'),
    size: get('size'),
    model: get('model'),
    variantType: get('variantType'),
    status: parseStatus(values[headerIndex.status]),
    salePrice: parsePrice(values[headerIndex.salePrice]),
    imageUrl: sanitizeImageUrl(values[headerIndex.imageUrl]),
    stock: parseStock(values[headerIndex.stock]),
  };
}

function resolveStorefrontCategory(row) {
  const productType = normalizeKey(row.productType);
  const sportColumn = normalizeKey(row.sport);

  if (productType === 'JERSEY') return 'JERSEY';
  if (sportColumn === 'MUJER' || WOMEN_PRODUCT_TYPES.has(productType)) {
    return 'MUJER';
  }
  if (FOOTWEAR_PRODUCT_TYPES.has(productType)) return 'CALZADO';
  if (ACCESSORY_PRODUCT_TYPES.has(productType)) return 'ACCESORIOS';
  return 'HOMBRE';
}

function buildProductReference(row) {
  const reference = normalize(row.reference) || normalize(row.model) || row.itemNo;
  const variantType = normalize(row.variantType);

  if (!variantType) return reference;
  return `${reference}|${variantType}`;
}

function buildProductName(row) {
  return normalize(row.description) || buildProductReference(row);
}

function isSportValue(value) {
  const key = normalizeKey(value);
  return Boolean(key) && !NON_SPORT_VALUES.has(key);
}

function readExcelRows(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: '',
    raw: true,
  });

  const headerRowIndex = matrix.findIndex((row) =>
    row.some((cell) => normalizeKey(cell) === 'NO'),
  );

  if (headerRowIndex < 0) {
    throw new Error('Could not locate the header row (expected a "No" column).');
  }

  const headerIndex = resolveHeaderIndex(matrix[headerRowIndex]);
  const rows = [];

  for (let index = headerRowIndex + 1; index < matrix.length; index += 1) {
    const values = matrix[index];
    if (!values?.length) continue;

    const mapped = mapRow(values, headerIndex);
    if (!mapped.itemNo && !mapped.reference && !mapped.description) continue;
    if (!mapped.itemNo) {
      throw new Error(`Row ${index + 1} is missing item number (No).`);
    }

    rows.push(mapped);
  }

  return rows;
}

function groupRowsByProduct(rows) {
  const groups = new Map();

  for (const row of rows) {
    const productKey = buildProductReference(row);
    if (!groups.has(productKey)) {
      groups.set(productKey, {
        productKey,
        reference: buildProductReference(row),
        name: buildProductName(row),
        storefrontCategory: resolveStorefrontCategory(row),
        sport: isSportValue(row.sport) ? normalize(row.sport) : null,
        brand: normalize(row.brand),
        model: normalize(row.model) || null,
        variantType: normalize(row.variantType) || null,
        imageUrl: row.imageUrl,
        variants: [],
      });
    }

    const group = groups.get(productKey);
    if (!group.imageUrl && row.imageUrl) group.imageUrl = row.imageUrl;
    group.variants.push(row);
  }

  return [...groups.values()];
}

async function getOrCreateCatalog(prisma, cache, model, companyId, name, extra = {}) {
  const key = normalizeKey(name);
  if (!key) return null;

  const cacheKey = `${model}:${key}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const record = await prisma[model].upsert({
    where: {
      companyId_name: {
        companyId,
        name: normalize(name),
      },
    },
    update: { isActive: true, ...extra },
    create: {
      companyId,
      name: normalize(name),
      isActive: true,
      ...extra,
    },
  });

  cache.set(cacheKey, record);
  return record;
}

async function ensureBaseCatalogs(prisma, companyId) {
  for (const name of STOREFRONT_CATEGORIES) {
    await prisma.category.upsert({
      where: { companyId_name: { companyId, name } },
      update: { isActive: true },
      create: { companyId, name, isActive: true },
    });
  }
}

async function reconcileStock(tx, companyId, userId, variantId, targetStock) {
  const variant = await tx.productVariant.findFirst({
    where: { id: variantId, companyId },
  });

  if (!variant) return;

  const delta = targetStock - variant.stock;
  if (delta === 0) return;

  const type =
    delta > 0 ? StockMovementType.IN : StockMovementType.OUT;
  const reason =
    delta > 0
      ? StockMovementReason.POSITIVE_ADJUSTMENT
      : StockMovementReason.NEGATIVE_ADJUSTMENT;
  const quantity = Math.abs(delta);
  const stockBefore = variant.stock;
  const stockAfter = targetStock;

  await tx.stockMovement.create({
    data: {
      companyId,
      variantId,
      type,
      reason,
      quantity,
      stockBefore,
      stockAfter,
      note: 'Importacion Excel',
      reference: 'excel-import',
      createdById: userId,
    },
  });

  await tx.productVariant.update({
    where: { id: variantId },
    data: { stock: stockAfter },
  });
}

async function importVariant(
  tx,
  {
    companyId,
    userId,
    productId,
    productImageUrl,
    row,
    sizeId,
    updateExisting,
  },
) {
  const existing = await tx.productVariant.findFirst({
    where: {
      companyId,
      OR: [{ itemNo: row.itemNo }, { productId, sizeId }],
    },
  });

  if (existing && !updateExisting) {
    return { action: 'skipped-variant', itemNo: row.itemNo };
  }

  if (existing) {
    await tx.productVariant.update({
      where: { id: existing.id },
      data: {
        itemNo: row.itemNo,
        salePrice: row.salePrice,
        status: row.status,
        imageUrl: row.imageUrl || productImageUrl,
      },
    });

    await reconcileStock(tx, companyId, userId, existing.id, row.stock);

    return { action: 'updated-variant', itemNo: row.itemNo };
  }

  const variant = await tx.productVariant.create({
    data: {
      companyId,
      productId,
      sizeId,
      itemNo: row.itemNo,
      sku: row.itemNo,
      salePrice: row.salePrice,
      stock: 0,
      status: row.status,
      imageUrl: row.imageUrl || productImageUrl,
    },
  });

  if (row.stock > 0) {
    await tx.stockMovement.create({
      data: {
        companyId,
        variantId: variant.id,
        type: StockMovementType.IN,
        reason: StockMovementReason.INITIAL,
        quantity: row.stock,
        stockBefore: 0,
        stockAfter: row.stock,
        note: 'Stock inicial importado desde Excel',
        reference: 'excel-import',
        createdById: userId,
      },
    });

    await tx.productVariant.update({
      where: { id: variant.id },
      data: { stock: row.stock },
    });
  }

  return { action: 'created-variant', itemNo: row.itemNo };
}

async function importProductGroup(
  prisma,
  {
    companyId,
    userId,
    group,
    caches,
    updateExisting,
  },
) {
  const category = await getOrCreateCatalog(
    prisma,
    caches.catalog,
    'category',
    companyId,
    group.storefrontCategory,
  );

  const brand = await getOrCreateCatalog(
    prisma,
    caches.catalog,
    'brand',
    companyId,
    group.brand,
  );

  const sport = group.sport
    ? await getOrCreateCatalog(
        prisma,
        caches.catalog,
        'sport',
        companyId,
        group.sport,
      )
    : null;

  const productType = group.variantType
    ? await getOrCreateCatalog(
        prisma,
        caches.catalog,
        'productType',
        companyId,
        group.variantType,
      )
    : null;

  const productModel = group.model
    ? await getOrCreateCatalog(
        prisma,
        caches.catalog,
        'productModel',
        companyId,
        group.model,
      )
    : null;

  let product = await prisma.product.findFirst({
    where: {
      companyId,
      reference: group.reference,
    },
  });

  if (!product) {
    product = await prisma.product.create({
      data: {
        companyId,
        reference: group.reference,
        name: group.name,
        description: group.name,
        categoryId: category.id,
        brandId: brand.id,
        sportId: sport?.id ?? null,
        productTypeId: productType?.id ?? null,
        productModelId: productModel?.id ?? null,
        imageUrl: group.imageUrl,
        isActive: group.variants.some(
          (variant) => variant.status === ProductStatus.ACTIVE,
        ),
      },
    });
  } else {
    product = await prisma.product.update({
      where: { id: product.id },
      data: {
        name: group.name,
        description: group.name,
        categoryId: category.id,
        brandId: brand.id,
        sportId: sport?.id ?? null,
        productTypeId: productType?.id ?? null,
        productModelId: productModel?.id ?? null,
        imageUrl: group.imageUrl ?? product.imageUrl,
        isActive:
          product.isActive ||
          group.variants.some(
            (variant) => variant.status === ProductStatus.ACTIVE,
          ),
      },
    });
  }

  const stats = {
    createdVariants: 0,
    updatedVariants: 0,
    skippedVariants: 0,
  };

  for (const row of group.variants) {
    let sizeSortOrder = caches.sizeSortOrder.get(normalizeKey(row.size));
    if (sizeSortOrder === undefined) {
      sizeSortOrder = caches.nextSizeSortOrder;
      caches.nextSizeSortOrder += 1;
      caches.sizeSortOrder.set(normalizeKey(row.size), sizeSortOrder);
    }

    const size = await getOrCreateCatalog(
      prisma,
      caches.catalog,
      'size',
      companyId,
      row.size,
      { sortOrder: sizeSortOrder },
    );

    const result = await prisma.$transaction((tx) =>
      importVariant(tx, {
        companyId,
        userId,
        productId: product.id,
        productImageUrl: group.imageUrl,
        row,
        sizeId: size.id,
        updateExisting,
      }),
    );

    if (result.action === 'created-variant') stats.createdVariants += 1;
    else if (result.action === 'updated-variant') stats.updatedVariants += 1;
    else stats.skippedVariants += 1;
  }

  return stats;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rows = readExcelRows(options.file);
  const productGroups = groupRowsByProduct(rows);

  console.log(`Excel file: ${options.file}`);
  console.log(`Rows parsed: ${rows.length}`);
  console.log(`Products grouped: ${productGroups.length}`);

  if (options.dryRun) {
    const categoryCounts = new Map();
    for (const group of productGroups) {
      categoryCounts.set(
        group.storefrontCategory,
        (categoryCounts.get(group.storefrontCategory) || 0) + 1,
      );
    }

    console.log('\nDry run only. Category distribution:');
    for (const [category, count] of [...categoryCounts.entries()].sort()) {
      console.log(`  ${category}: ${count} products`);
    }
    return;
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const company = await prisma.company.findFirst({
      where: {
        externalId: options.companyExternalId,
        isActive: true,
      },
    });

    if (!company) {
      throw new Error(
        `Company not found for external id "${options.companyExternalId}". Run prisma:seed first.`,
      );
    }

    const adminUser = await prisma.user.findFirst({
      where: { email: 'admin@spotdeportivo.local', isActive: true },
    });

    if (!adminUser) {
      throw new Error('Admin user not found. Run prisma:seed first.');
    }

    await ensureBaseCatalogs(prisma, company.id);

    const caches = {
      catalog: new Map(),
      sizeSortOrder: new Map(),
      nextSizeSortOrder: 100,
    };

    const totals = {
      createdVariants: 0,
      updatedVariants: 0,
      skippedVariants: 0,
    };

    for (const [index, group] of productGroups.entries()) {
      const stats = await importProductGroup(prisma, {
        companyId: company.id,
        userId: adminUser.id,
        group,
        caches,
        updateExisting: options.updateExisting,
      });

      totals.createdVariants += stats.createdVariants;
      totals.updatedVariants += stats.updatedVariants;
      totals.skippedVariants += stats.skippedVariants;

      if ((index + 1) % 25 === 0 || index + 1 === productGroups.length) {
        console.log(`Processed ${index + 1}/${productGroups.length} products...`);
      }
    }

    console.log('\nImport completed.');
    console.log(`  Variants created: ${totals.createdVariants}`);
    console.log(`  Variants updated: ${totals.updatedVariants}`);
    console.log(`  Variants skipped: ${totals.skippedVariants}`);
    console.log(`  Company: ${company.name} (${company.externalId})`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  const message =
    error?.meta?.message ||
    error?.message ||
    String(error);

  console.error('Excel import failed:', message);

  if (!process.env.DATABASE_URL) {
    console.error(
      'Hint: DATABASE_URL is missing. Ensure api-nest/.env exists and contains a valid PostgreSQL URL.',
    );
  } else if (/P1001|P1017|ECONNREFUSED|ENOTFOUND/i.test(message)) {
    console.error(
      'Hint: Could not reach PostgreSQL. Check Neon/network and run `npm run prisma:deploy` first.',
    );
  } else if (/relation .* does not exist|P2021/i.test(message)) {
    console.error(
      'Hint: Database schema is outdated. Run `npm run prisma:deploy` before importing.',
    );
  }

  process.exit(1);
});
