/**
 * Elimina productos, variantes y movimientos de stock.
 * Conserva catálogos, usuarios, roles y configuración de la empresa.
 *
 * Uso:
 *   npm run prisma:clear-products
 *   npm run prisma:clear-products -- --company cmp_spot_deportivo
 *   npm run prisma:clear-products -- --all
 */
const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../.env'),
  override: true,
});

const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');

const DEFAULT_COMPANY_EXTERNAL_ID = 'cmp_spot_deportivo';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function parseArgs(argv) {
  const options = {
    all: false,
    companyExternalId: DEFAULT_COMPANY_EXTERNAL_ID,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--all') options.all = true;
    else if (arg === '--company') {
      options.companyExternalId = argv[index + 1] || DEFAULT_COMPANY_EXTERNAL_ID;
      index += 1;
    }
  }

  return options;
}

async function clearProductsForCompany(companyId) {
  const movements = await prisma.stockMovement.deleteMany({
    where: { companyId },
  });
  const variants = await prisma.productVariant.deleteMany({
    where: { companyId },
  });
  const products = await prisma.product.deleteMany({
    where: { companyId },
  });

  return { movements, variants, products };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.all) {
    const movements = await prisma.stockMovement.deleteMany();
    const variants = await prisma.productVariant.deleteMany();
    const products = await prisma.product.deleteMany();

    console.log('Productos eliminados (todas las empresas):');
    console.log(`  Movimientos: ${movements.count}`);
    console.log(`  Variantes:   ${variants.count}`);
    console.log(`  Productos:   ${products.count}`);
    return;
  }

  const company = await prisma.company.findFirst({
    where: { externalId: options.companyExternalId, isActive: true },
    select: { id: true, name: true, externalId: true },
  });

  if (!company) {
    throw new Error(
      `Empresa no encontrada para externalId "${options.companyExternalId}".`,
    );
  }

  const result = await clearProductsForCompany(company.id);

  console.log(`Productos eliminados para ${company.name} (${company.externalId}):`);
  console.log(`  Movimientos: ${result.movements.count}`);
  console.log(`  Variantes:   ${result.variants.count}`);
  console.log(`  Productos:   ${result.products.count}`);
}

main()
  .catch((error) => {
    console.error('Error eliminando productos:', error.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
