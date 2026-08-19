const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../.env'),
});

const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient, ProductStatus } = require('@prisma/client');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const { seedSpotDeportivoAuth } = require('./lib/seed-auth');

const COMPANY_EXTERNAL_ID = 'cmp_spot_deportivo';

async function main() {
  const company = await prisma.company.upsert({
    where: { slug: 'spot-deportivo' },
    update: { isActive: true, externalId: COMPANY_EXTERNAL_ID },
    create: {
      externalId: COMPANY_EXTERNAL_ID,
      name: 'Spot Deportivo Pro',
      slug: 'spot-deportivo',
      isActive: true,
    },
  });

  const users = await seedSpotDeportivoAuth(prisma, company);

  const categoryNames = ['JERSEY', 'HOMBRE', 'MUJER', 'CALZADO', 'ACCESORIOS', 'NUEVAS COLECCIONES'];
  const sizeNames = [
    { name: 'SMALL', sortOrder: 1 },
    { name: 'MEDIUM', sortOrder: 2 },
    { name: 'LARGE', sortOrder: 3 },
    { name: 'XL', sortOrder: 4 },
    { name: 'XXL', sortOrder: 5 },
  ];

  for (const name of categoryNames) {
    await prisma.category.upsert({
      where: { companyId_name: { companyId: company.id, name } },
      update: { isActive: true },
      create: { companyId: company.id, name },
    });
  }

  for (const sizeSeed of sizeNames) {
    await prisma.size.upsert({
      where: { companyId_name: { companyId: company.id, name: sizeSeed.name } },
      update: { sortOrder: sizeSeed.sortOrder, isActive: true },
      create: { companyId: company.id, name: sizeSeed.name, sortOrder: sizeSeed.sortOrder },
    });
  }

  const [category, sport, brand, color, model, size] = await Promise.all([
    prisma.category.findFirstOrThrow({
      where: { companyId: company.id, name: 'JERSEY' },
    }),
    prisma.sport.upsert({
      where: { companyId_name: { companyId: company.id, name: 'BASEBALL' } },
      update: {},
      create: { companyId: company.id, name: 'BASEBALL' },
    }),
    prisma.brand.upsert({
      where: { companyId_name: { companyId: company.id, name: 'NYM' } },
      update: {},
      create: { companyId: company.id, name: 'NYM' },
    }),
    prisma.color.upsert({
      where: { companyId_name: { companyId: company.id, name: 'LOCAL' } },
      update: {},
      create: { companyId: company.id, name: 'LOCAL' },
    }),
    prisma.productModel.upsert({
      where: { companyId_name: { companyId: company.id, name: 'JUAN SOTO' } },
      update: {},
      create: { companyId: company.id, name: 'JUAN SOTO' },
    }),
    prisma.size.findFirstOrThrow({
      where: { companyId: company.id, name: 'SMALL' },
    }),
  ]);

  const product = await prisma.product.upsert({
    where: {
      companyId_reference: {
        companyId: company.id,
        reference: 'JUAN SOTO',
      },
    },
    update: {
      name: 'JERSEY NYM JUAN SOTO',
      categoryId: category.id,
      sportId: sport.id,
      brandId: brand.id,
      productModelId: model.id,
    },
    create: {
      companyId: company.id,
      reference: 'JUAN SOTO',
      name: 'JERSEY NYM JUAN SOTO',
      categoryId: category.id,
      sportId: sport.id,
      brandId: brand.id,
      productModelId: model.id,
      isActive: true,
    },
  });

  await prisma.productVariant.upsert({
    where: {
      companyId_productId_colorId_sizeId: {
        companyId: company.id,
        productId: product.id,
        colorId: color.id,
        sizeId: size.id,
      },
    },
    update: {
      salePrice: 1490,
      stock: 4,
      status: ProductStatus.ACTIVE,
      itemNo: '0001',
    },
    create: {
      companyId: company.id,
      productId: product.id,
      colorId: color.id,
      sizeId: size.id,
      itemNo: '0001',
      salePrice: 1490,
      stock: 4,
      status: ProductStatus.ACTIVE,
    },
  });

  console.log('Seed completed successfully');
  console.log('Company slug: spot-deportivo');
  console.log('Company external id:', COMPANY_EXTERNAL_ID);
  console.log('Users:');
  for (const user of users) {
    console.log(`- ${user.email} (${user.role})`);
  }
}

main()
  .catch((error) => {
    console.error('Seed failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
