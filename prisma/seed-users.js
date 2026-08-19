const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '../.env'),
});

const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { seedSpotDeportivoAuth } = require('./lib/seed-auth');

const COMPANY_EXTERNAL_ID = 'cmp_spot_deportivo';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

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

  console.log('Spot Deportivo users ready:');
  for (const user of users) {
    console.log(`- ${user.email} (${user.role})`);
  }
  console.log('Legacy admin@spotdeportivo.local deactivated if it existed.');
  console.log('Set SEED_ADMIN_PASSWORD, SEED_INVENTORY_PASSWORD and SEED_CATALOG_PASSWORD in .env to control passwords.');
}

main()
  .catch((error) => {
    console.error('User seed failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
