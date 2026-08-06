import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListPublicProductsQueryDto } from './dto/list-public-products-query.dto';
import { ListVariantsQueryDto } from './dto/list-variants-query.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  private buildPublicOrderBy(
    sortBy: ListPublicProductsQueryDto['sortBy'],
    sortOrder: Prisma.SortOrder,
  ): Prisma.ProductVariantOrderByWithRelationInput {
    switch (sortBy) {
      case 'salePrice':
        return { salePrice: sortOrder };
      case 'stock':
        return { stock: sortOrder };
      case 'productName':
        return { product: { name: sortOrder } };
      case 'reference':
        return { product: { reference: sortOrder } };
      case 'model':
        return { product: { productModel: { name: sortOrder } } };
      case 'category':
        return { product: { category: { name: sortOrder } } };
      case 'brand':
        return { product: { brand: { name: sortOrder } } };
      case 'createdAt':
      default:
        return { createdAt: sortOrder };
    }
  }

  private buildPublicProductOrderBy(
    sortBy: ListPublicProductsQueryDto['sortBy'],
    sortOrder: Prisma.SortOrder,
  ): Prisma.ProductOrderByWithRelationInput {
    switch (sortBy) {
      case 'productName':
        return { name: sortOrder };
      case 'reference':
        return { reference: sortOrder };
      case 'model':
        return { productModel: { name: sortOrder } };
      case 'category':
        return { category: { name: sortOrder } };
      case 'brand':
        return { brand: { name: sortOrder } };
      case 'createdAt':
      default:
        return { createdAt: sortOrder };
    }
  }

  private buildPublicVariantWhere(
    companyId: string,
    query: ListPublicProductsQueryDto,
  ): Prisma.ProductVariantWhereInput {
    const andFilters: Prisma.ProductVariantWhereInput[] = [
      {
        product: {
          isActive: true,
        },
      },
    ];

    if (query.status) {
      andFilters.push({ status: query.status as ProductStatus });
    }

    if (query.inStock) {
      andFilters.push({ stock: { gt: 0 } });
    }

    if (query.name) {
      andFilters.push({
        product: { name: { contains: query.name, mode: 'insensitive' } },
      });
    }

    if (query.categoryId) {
      andFilters.push({ product: { categoryId: query.categoryId } });
    }

    if (query.categorySlug) {
      andFilters.push({
        product: {
          category: {
            name: { equals: query.categorySlug, mode: 'insensitive' },
          },
        },
      });
    }

    if (query.category) {
      andFilters.push({
        product: {
          category: { name: { contains: query.category, mode: 'insensitive' } },
        },
      });
    }

    if (query.brand) {
      andFilters.push({
        product: { brand: { name: { contains: query.brand, mode: 'insensitive' } } },
      });
    }

    if (query.model) {
      andFilters.push({
        product: {
          productModel: { name: { contains: query.model, mode: 'insensitive' } },
        },
      });
    }

    if (query.reference) {
      andFilters.push({
        product: {
          reference: { contains: query.reference, mode: 'insensitive' },
        },
      });
    }

    return {
      companyId,
      AND: andFilters,
      ...(query.search
        ? {
            OR: [
              {
                product: {
                  name: { contains: query.search, mode: 'insensitive' },
                },
              },
              {
                product: {
                  reference: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                product: {
                  productModel: {
                    name: { contains: query.search, mode: 'insensitive' },
                  },
                },
              },
              {
                product: {
                  category: {
                    name: { contains: query.search, mode: 'insensitive' },
                  },
                },
              },
              {
                product: {
                  brand: {
                    name: { contains: query.search, mode: 'insensitive' },
                  },
                },
              },
              { itemNo: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  async listPublicCategories(companyExternalId: string) {
    const company = await this.prisma.company.findFirst({
      where: { externalId: companyExternalId, isActive: true },
      select: { id: true, externalId: true, name: true, slug: true },
    });

    if (!company) {
      throw new NotFoundException('Company not found for external id');
    }

    const categories = await this.prisma.category.findMany({
      where: { companyId: company.id, isActive: true },
      orderBy: { name: 'asc' },
    });

    const productCounts = await Promise.all(
      categories.map((category) =>
        this.prisma.product.count({
          where: {
            companyId: company.id,
            categoryId: category.id,
            isActive: true,
            variants: {
              some: {
                status: ProductStatus.ACTIVE,
              },
            },
          },
        }),
      ),
    );

    return {
      company,
      items: categories.map((category, index) => ({
        id: category.id,
        name: category.name,
        slug: category.name,
        productCount: productCounts[index],
      })),
    };
  }

  async listPublicProducts(
    companyExternalId: string,
    query: ListPublicProductsQueryDto,
  ) {
    const company = await this.prisma.company.findFirst({
      where: { externalId: companyExternalId, isActive: true },
      select: { id: true, externalId: true, name: true, slug: true },
    });

    if (!company) {
      throw new NotFoundException('Company not found for external id');
    }

    if (query.groupByStyle) {
      return this.listPublicProductsByStyle(company, query);
    }

    if (query.groupByProduct) {
      return this.listPublicProductsGrouped(company, query);
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder: Prisma.SortOrder = query.sortOrder ?? 'desc';
    const where = this.buildPublicVariantWhere(company.id, query);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.productVariant.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: this.buildPublicOrderBy(sortBy, sortOrder),
        include: {
          size: true,
          product: {
            include: {
              category: true,
              sport: true,
              brand: true,
              productType: true,
              productModel: true,
            },
          },
        },
      }),
      this.prisma.productVariant.count({ where }),
    ]);

    return {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      company,
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.product.name,
        reference: item.product.reference,
        description: item.product.description,
        category: item.product.category.name,
        categorySlug: item.product.category.name,
        sport: item.product.sport?.name ?? null,
        brand: item.product.brand.name,
        type: item.product.productType?.name ?? null,
        model: item.product.productModel?.name ?? null,
        size: item.size.name,
        itemNo: item.itemNo,
        sku: item.sku,
        status: item.status,
        imageUrl: item.imageUrl || item.product.imageUrl,
        salePrice: Number(item.salePrice),
        stock: item.stock,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    };
  }

  private async listPublicProductsGrouped(
    company: { id: string; externalId: string | null; name: string; slug: string },
    query: ListPublicProductsQueryDto,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder: Prisma.SortOrder = query.sortOrder ?? 'desc';
    const variantWhere = this.buildPublicVariantWhere(company.id, query);

    const matchingVariants = await this.prisma.productVariant.findMany({
      where: variantWhere,
      select: { productId: true },
      distinct: ['productId'],
    });

    const productIds = matchingVariants.map((entry) => entry.productId);
    const productWhere: Prisma.ProductWhereInput = {
      id: { in: productIds.length ? productIds : ['__none__'] },
      companyId: company.id,
      isActive: true,
    };

    const [products, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where: productWhere,
        skip,
        take: pageSize,
        orderBy: this.buildPublicProductOrderBy(sortBy, sortOrder),
        include: {
          category: true,
          brand: true,
          productType: true,
          productModel: true,
          variants: {
            where: variantWhere,
            include: { size: true },
            orderBy: [{ size: { sortOrder: 'asc' } }, { size: { name: 'asc' } }],
          },
        },
      }),
      this.prisma.product.count({ where: productWhere }),
    ]);

    return {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      company,
      items: products.map((product) => ({
        productId: product.id,
        name: product.name,
        reference: product.reference,
        description: product.description,
        category: product.category.name,
        categorySlug: product.category.name,
        brand: product.brand.name,
        type: product.productType?.name ?? null,
        model: product.productModel?.name ?? null,
        imageUrl: product.imageUrl,
        variants: product.variants.map((variant) => ({
          id: variant.id,
          size: variant.size.name,
          type: product.productType?.name ?? null,
          itemNo: variant.itemNo,
          sku: variant.sku,
          salePrice: Number(variant.salePrice),
          stock: variant.stock,
          imageUrl: variant.imageUrl || product.imageUrl,
          status: variant.status,
        })),
      })),
    };
  }

  private buildStyleKey(product: {
    categoryId: string;
    brandId: string;
    productModelId: string | null;
    reference: string;
  }) {
    if (product.productModelId) {
      return `${product.categoryId}:${product.brandId}:${product.productModelId}`;
    }

    const baseReference = product.reference.includes('|')
      ? product.reference.split('|')[0]
      : product.reference;

    return `${product.categoryId}:${product.brandId}:ref:${baseReference}`;
  }

  private buildStyleTitle(
    brand: string,
    model: string | null,
    reference: string,
  ) {
    if (model) {
      return `${brand} ${model}`.trim();
    }

    const baseReference = reference.includes('|')
      ? reference.split('|')[0]
      : reference;

    return `${brand} ${baseReference}`.trim();
  }

  private async listPublicProductsByStyle(
    company: { id: string; externalId: string | null; name: string; slug: string },
    query: ListPublicProductsQueryDto,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder: Prisma.SortOrder = query.sortOrder ?? 'desc';
    const variantWhere = this.buildPublicVariantWhere(company.id, query);

    const matchingVariants = await this.prisma.productVariant.findMany({
      where: variantWhere,
      select: { productId: true },
      distinct: ['productId'],
    });

    const productIds = matchingVariants.map((entry) => entry.productId);

    const products = await this.prisma.product.findMany({
      where: {
        id: { in: productIds.length ? productIds : ['__none__'] },
        companyId: company.id,
        isActive: true,
      },
      include: {
        category: true,
        brand: true,
        productModel: true,
        productType: true,
        variants: {
          where: variantWhere,
          include: { size: true },
          orderBy: [{ size: { sortOrder: 'asc' } }, { size: { name: 'asc' } }],
        },
      },
    });

    type StyleAccumulator = {
      styleKey: string;
      styleTitle: string;
      category: string;
      categorySlug: string;
      brand: string;
      model: string | null;
      defaultProductId: string;
      imageUrl: string | null;
      productIds: Set<string>;
      sizes: Set<string>;
      prices: number[];
      hasStock: boolean;
      latestCreatedAt: Date;
      minPriceValue: number | null;
    };

    const styleMap = new Map<string, StyleAccumulator>();

    for (const product of products) {
      if (!product.variants.length) continue;

      const styleKey = this.buildStyleKey(product);
      let acc = styleMap.get(styleKey);

      if (!acc) {
        acc = {
          styleKey,
          styleTitle: this.buildStyleTitle(
            product.brand.name,
            product.productModel?.name ?? null,
            product.reference,
          ),
          category: product.category.name,
          categorySlug: product.category.name,
          brand: product.brand.name,
          model: product.productModel?.name ?? null,
          defaultProductId: product.id,
          imageUrl: product.imageUrl,
          productIds: new Set(),
          sizes: new Set(),
          prices: [],
          hasStock: false,
          latestCreatedAt: product.createdAt,
          minPriceValue: null,
        };
        styleMap.set(styleKey, acc);
      }

      acc.productIds.add(product.id);
      if (!acc.imageUrl && product.imageUrl) {
        acc.imageUrl = product.imageUrl;
      }
      if (product.createdAt > acc.latestCreatedAt) {
        acc.latestCreatedAt = product.createdAt;
      }

      for (const variant of product.variants) {
        acc.sizes.add(variant.size.name);
        const price = Number(variant.salePrice);
        if (price > 0) {
          acc.prices.push(price);
          acc.minPriceValue =
            acc.minPriceValue === null
              ? price
              : Math.min(acc.minPriceValue, price);
        }
        if (variant.stock > 0) {
          acc.hasStock = true;
        }
      }
    }

    let styles = Array.from(styleMap.values()).map((acc) => ({
      styleKey: acc.styleKey,
      styleTitle: acc.styleTitle,
      category: acc.category,
      categorySlug: acc.categorySlug,
      brand: acc.brand,
      model: acc.model,
      defaultProductId: acc.defaultProductId,
      imageUrl: acc.imageUrl,
      colorCount: acc.productIds.size,
      sizeCount: acc.sizes.size,
      minPrice: acc.prices.length ? Math.min(...acc.prices) : 0,
      maxPrice: acc.prices.length ? Math.max(...acc.prices) : 0,
      hasStock: acc.hasStock,
      latestCreatedAt: acc.latestCreatedAt,
      minPriceValue: acc.minPriceValue,
    }));

    styles.sort((a, b) => {
      switch (sortBy) {
        case 'productName':
          return sortOrder === 'asc'
            ? a.styleTitle.localeCompare(b.styleTitle)
            : b.styleTitle.localeCompare(a.styleTitle);
        case 'brand':
          return sortOrder === 'asc'
            ? a.brand.localeCompare(b.brand)
            : b.brand.localeCompare(a.brand);
        case 'model':
          return sortOrder === 'asc'
            ? (a.model ?? '').localeCompare(b.model ?? '')
            : (b.model ?? '').localeCompare(a.model ?? '');
        case 'category':
          return sortOrder === 'asc'
            ? a.category.localeCompare(b.category)
            : b.category.localeCompare(a.category);
        case 'salePrice':
          return sortOrder === 'asc'
            ? (a.minPriceValue ?? 0) - (b.minPriceValue ?? 0)
            : (b.minPriceValue ?? 0) - (a.minPriceValue ?? 0);
        case 'createdAt':
        default:
          return sortOrder === 'asc'
            ? a.latestCreatedAt.getTime() - b.latestCreatedAt.getTime()
            : b.latestCreatedAt.getTime() - a.latestCreatedAt.getTime();
      }
    });

    const total = styles.length;
    const items = styles.slice(skip, skip + pageSize).map(
      ({ latestCreatedAt, minPriceValue, ...item }) => item,
    );

    return {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      company,
      items,
    };
  }

  private buildOrderBy(
    sortBy: ListVariantsQueryDto['sortBy'],
    sortOrder: Prisma.SortOrder,
  ): Prisma.ProductVariantOrderByWithRelationInput {
    switch (sortBy) {
      case 'salePrice':
        return { salePrice: sortOrder };
      case 'stock':
        return { stock: sortOrder };
      case 'productName':
        return { product: { name: sortOrder } };
      case 'reference':
        return { product: { reference: sortOrder } };
      case 'createdAt':
      default:
        return { createdAt: sortOrder };
    }
  }

  async listVariants(companyId: string, query: ListVariantsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder: Prisma.SortOrder = query.sortOrder ?? 'desc';
    const andFilters: Prisma.ProductVariantWhereInput[] = [];

    if (query.sizeId) {
      andFilters.push({ sizeId: query.sizeId });
    }

    if (query.categoryId) {
      andFilters.push({ product: { categoryId: query.categoryId } });
    }

    if (query.brandId) {
      andFilters.push({ product: { brandId: query.brandId } });
    }

    const where: Prisma.ProductVariantWhereInput = {
      companyId,
      ...(query.status ? { status: query.status } : {}),
      ...(andFilters.length ? { AND: andFilters } : {}),
      ...(query.search
        ? {
            OR: [
              {
                product: {
                  name: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                product: {
                  reference: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
              },
              { itemNo: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.productVariant.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: this.buildOrderBy(sortBy, sortOrder),
        include: {
          size: true,
          product: {
            include: {
              category: true,
              sport: true,
              brand: true,
              productType: true,
              productModel: true,
            },
          },
        },
      }),
      this.prisma.productVariant.count({ where }),
    ]);

    return {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      items: items.map((item) => ({
        ...item,
        salePrice: Number(item.salePrice),
      })),
    };
  }

  async getPublicProductStyleDetail(
    companyExternalId: string,
    productId: string,
  ) {
    const company = await this.prisma.company.findFirst({
      where: { externalId: companyExternalId, isActive: true },
      select: { id: true, externalId: true, name: true, slug: true },
    });

    if (!company) {
      throw new NotFoundException('Company not found for external id');
    }

    const anchorProduct = await this.prisma.product.findFirst({
      where: { id: productId, companyId: company.id, isActive: true },
      include: {
        category: true,
        brand: true,
        productType: true,
        productModel: true,
      },
    });

    if (!anchorProduct) {
      throw new NotFoundException('Product not found');
    }

    const siblingWhere = this.buildStyleSiblingWhere(company.id, anchorProduct);

    const siblingProducts = await this.prisma.product.findMany({
      where: siblingWhere,
      orderBy: [{ productType: { name: 'asc' } }, { name: 'asc' }],
      include: {
        productType: true,
        variants: {
          where: { status: ProductStatus.ACTIVE },
          include: { size: true },
          orderBy: [{ size: { sortOrder: 'asc' } }, { size: { name: 'asc' } }],
        },
      },
    });

    const colors = siblingProducts
      .filter((product) => product.variants.length > 0)
      .map((product) => this.mapPublicColorProduct(product));

    if (!colors.length) {
      throw new NotFoundException('Product has no active variants');
    }

    const styleTitle = this.buildStyleTitle(
      anchorProduct.brand.name,
      anchorProduct.productModel?.name ?? null,
      anchorProduct.reference,
    );

    return {
      company,
      productId: anchorProduct.id,
      styleKey: this.buildStyleKey(anchorProduct),
      styleTitle,
      category: anchorProduct.category.name,
      categorySlug: anchorProduct.category.name,
      brand: anchorProduct.brand.name,
      model: anchorProduct.productModel?.name ?? null,
      colors,
    };
  }

  private buildStyleSiblingWhere(
    companyId: string,
    product: {
      categoryId: string;
      brandId: string;
      productModelId: string | null;
      reference: string;
    },
  ): Prisma.ProductWhereInput {
    if (product.productModelId) {
      return {
        companyId,
        categoryId: product.categoryId,
        brandId: product.brandId,
        productModelId: product.productModelId,
        isActive: true,
      };
    }

    const baseReference = product.reference.includes('|')
      ? product.reference.split('|')[0]
      : product.reference;

    return {
      companyId,
      categoryId: product.categoryId,
      brandId: product.brandId,
      isActive: true,
      OR: [
        { reference: baseReference },
        { reference: { startsWith: `${baseReference}|` } },
      ],
    };
  }

  private extractColorLabel(
    product: {
      name: string;
      reference: string;
      productType: { name: string } | null;
    },
  ) {
    if (product.productType?.name) return product.productType.name;

    const pipeIndex = product.reference.indexOf('|');
    if (pipeIndex >= 0) {
      return product.reference.slice(pipeIndex + 1);
    }

    return 'Estándar';
  }

  private mapPublicColorProduct(product: {
    id: string;
    name: string;
    reference: string;
    imageUrl: string | null;
    productType: { name: string } | null;
    variants: {
      id: string;
      itemNo: string | null;
      sku: string | null;
      salePrice: Prisma.Decimal;
      stock: number;
      imageUrl: string | null;
      status: ProductStatus;
      size: { name: string };
    }[];
  }) {
    return {
      productId: product.id,
      color: this.extractColorLabel(product),
      reference: product.reference,
      imageUrl: product.imageUrl,
      variants: product.variants.map((variant) => ({
        id: variant.id,
        size: variant.size.name,
        itemNo: variant.itemNo,
        sku: variant.sku,
        salePrice: Number(variant.salePrice),
        stock: variant.stock,
        imageUrl: variant.imageUrl || product.imageUrl,
        status: variant.status,
      })),
    };
  }

  async getCatalogs(companyId: string) {
    const [categories, sports, brands, types, models, sizes] =
      await this.prisma.$transaction([
        this.prisma.category.findMany({
          where: { companyId, isActive: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.sport.findMany({
          where: { companyId, isActive: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.brand.findMany({
          where: { companyId, isActive: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.productType.findMany({
          where: { companyId, isActive: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.productModel.findMany({
          where: { companyId, isActive: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.size.findMany({
          where: { companyId, isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        }),
      ]);

    return { categories, sports, brands, types, models, sizes };
  }
}
