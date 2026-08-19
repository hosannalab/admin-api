const bcrypt = require('bcrypt');
const crypto = require('crypto');

const permissionSeeds = [
  { key: 'inventory.read', description: 'Read inventory records' },
  { key: 'inventory.create', description: 'Create inventory records' },
  { key: 'inventory.update', description: 'Update inventory records' },
  { key: 'inventory.inactivate', description: 'Inactivate inventory variants' },
  { key: 'catalog.read', description: 'Read catalog records' },
  { key: 'catalog.create', description: 'Create catalog records' },
  { key: 'catalog.update', description: 'Update catalog records' },
  { key: 'catalog.inactivate', description: 'Toggle catalog records' },
  { key: 'product.read', description: 'Read products' },
  { key: 'product.create', description: 'Create products' },
  { key: 'product.update', description: 'Update products' },
  { key: 'product.inactivate', description: 'Inactivate products' },
  { key: 'stock.read', description: 'Read stock movements' },
  { key: 'stock.move', description: 'Create stock movements' },
];

const roleDefinitions = [
  {
    name: 'super_admin',
    description: 'Acceso total al panel administrativo',
    isSystem: true,
    permissions: permissionSeeds.map((entry) => entry.key),
  },
  {
    name: 'inventory_manager',
    description: 'Gestiona inventario, productos y movimientos de stock',
    isSystem: true,
    permissions: [
      'inventory.read',
      'inventory.create',
      'inventory.update',
      'inventory.inactivate',
      'product.read',
      'product.create',
      'product.update',
      'product.inactivate',
      'catalog.read',
      'stock.read',
      'stock.move',
    ],
  },
  {
    name: 'catalog_manager',
    description: 'Gestiona catálogos generales y consulta productos',
    isSystem: true,
    permissions: [
      'catalog.read',
      'catalog.create',
      'catalog.update',
      'catalog.inactivate',
      'product.read',
      'inventory.read',
    ],
  },
];

const spotDeportivoUsers = [
  {
    email: 'admin@spotdeportivo.com',
    firstName: 'Administrador',
    lastName: 'Spot Deportivo',
    roleName: 'super_admin',
    passwordEnv: 'SEED_ADMIN_PASSWORD',
  },
  {
    email: 'inventario@spotdeportivo.com',
    firstName: 'Inventario',
    lastName: 'Spot Deportivo',
    roleName: 'inventory_manager',
    passwordEnv: 'SEED_INVENTORY_PASSWORD',
  },
  {
    email: 'catalogo@spotdeportivo.com',
    firstName: 'Catalogo',
    lastName: 'Spot Deportivo',
    roleName: 'catalog_manager',
    passwordEnv: 'SEED_CATALOG_PASSWORD',
  },
];

const LEGACY_ADMIN_EMAIL = 'admin@spotdeportivo.local';

function resolvePassword(envKey, email) {
  const configured = process.env[envKey]?.trim();
  if (configured) return configured;

  const generated = `Sp0rt-${crypto.randomBytes(9).toString('base64url')}!`;
  console.warn(`[seed-users] ${email}: set ${envKey} to reuse a password. Generated for this run: ${generated}`);
  return generated;
}

async function ensurePermissions(prisma) {
  const permissionsByKey = {};

  for (const permissionSeed of permissionSeeds) {
    const permission = await prisma.permission.upsert({
      where: { key: permissionSeed.key },
      update: { description: permissionSeed.description },
      create: permissionSeed,
    });
    permissionsByKey[permission.key] = permission;
  }

  return permissionsByKey;
}

async function ensureRole(prisma, companyId, roleDefinition, permissionsByKey) {
  const role = await prisma.role.upsert({
    where: {
      companyId_name: {
        companyId,
        name: roleDefinition.name,
      },
    },
    update: {
      description: roleDefinition.description,
      isSystem: roleDefinition.isSystem,
    },
    create: {
      companyId,
      name: roleDefinition.name,
      description: roleDefinition.description,
      isSystem: roleDefinition.isSystem,
    },
  });

  for (const permissionKey of roleDefinition.permissions) {
    const permission = permissionsByKey[permissionKey];
    if (!permission) continue;

    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: {
          roleId: role.id,
          permissionId: permission.id,
        },
      },
      update: {},
      create: {
        roleId: role.id,
        permissionId: permission.id,
      },
    });
  }

  return role;
}

async function ensureCompanyUser(prisma, companyId, userId) {
  await prisma.companyUser.upsert({
    where: {
      companyId_userId: {
        companyId,
        userId,
      },
    },
    update: { isActive: true },
    create: {
      companyId,
      userId,
      isActive: true,
    },
  });
}

async function ensureUserRole(prisma, companyId, userId, roleId) {
  await prisma.userRole.upsert({
    where: {
      userId_roleId_companyId: {
        userId,
        roleId,
        companyId,
      },
    },
    update: {},
    create: {
      userId,
      roleId,
      companyId,
    },
  });
}

async function ensureUserWithRole(prisma, companyId, rolesByName, userSeed) {
  const password = resolvePassword(userSeed.passwordEnv, userSeed.email);
  const passwordHash = await bcrypt.hash(password, 10);
  const role = rolesByName[userSeed.roleName];

  if (!role) {
    throw new Error(`Missing role ${userSeed.roleName} for ${userSeed.email}`);
  }

  const user = await prisma.user.upsert({
    where: { email: userSeed.email },
    update: {
      firstName: userSeed.firstName,
      lastName: userSeed.lastName,
      passwordHash,
      isActive: true,
    },
    create: {
      email: userSeed.email,
      firstName: userSeed.firstName,
      lastName: userSeed.lastName,
      passwordHash,
      isActive: true,
    },
  });

  await ensureCompanyUser(prisma, companyId, user.id);
  await ensureUserRole(prisma, companyId, user.id, role.id);

  return {
    email: user.email,
    role: userSeed.roleName,
    passwordConfigured: Boolean(process.env[userSeed.passwordEnv]?.trim()),
  };
}

async function deactivateLegacyAdmin(prisma) {
  await prisma.user.updateMany({
    where: { email: LEGACY_ADMIN_EMAIL },
    data: { isActive: false },
  });
}

async function seedSpotDeportivoAuth(prisma, company) {
  const permissionsByKey = await ensurePermissions(prisma);
  const rolesByName = {};

  for (const roleDefinition of roleDefinitions) {
    rolesByName[roleDefinition.name] = await ensureRole(
      prisma,
      company.id,
      roleDefinition,
      permissionsByKey,
    );
  }

  const createdUsers = [];
  for (const userSeed of spotDeportivoUsers) {
    createdUsers.push(await ensureUserWithRole(prisma, company.id, rolesByName, userSeed));
  }

  await deactivateLegacyAdmin(prisma);

  return createdUsers;
}

module.exports = {
  permissionSeeds,
  roleDefinitions,
  spotDeportivoUsers,
  seedSpotDeportivoAuth,
};
