export const CATALOG_RESOURCES = {
  categories: {
    path: 'categories',
    model: 'category',
    label: 'Categoría',
    orderBy: { name: 'asc' },
  },
  brands: {
    path: 'brands',
    model: 'brand',
    label: 'Marca',
    orderBy: { name: 'asc' },
  },
  sizes: {
    path: 'sizes',
    model: 'size',
    label: 'Talla',
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    extraFields: ['sortOrder'],
  },
  sports: {
    path: 'sports',
    model: 'sport',
    label: 'Deporte',
    orderBy: { name: 'asc' },
  },
  'product-types': {
    path: 'product-types',
    model: 'productType',
    label: 'Tipo de producto',
    orderBy: { name: 'asc' },
  },
  'product-models': {
    path: 'product-models',
    model: 'productModel',
    label: 'Modelo',
    orderBy: { name: 'asc' },
  },
} as const;

export type CatalogResourceKey = keyof typeof CATALOG_RESOURCES;

export function resolveCatalogResource(resource: string) {
  const entry = Object.entries(CATALOG_RESOURCES).find(
    ([, config]) => config.path === resource,
  );

  if (!entry) {
    return null;
  }

  return {
    key: entry[0] as CatalogResourceKey,
    config: entry[1],
  };
}
