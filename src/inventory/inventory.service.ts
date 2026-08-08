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
          color: true,
          product: {
            include: {
              category: true,
              sport: true,
              brand: true,
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
        color: item.color.name,
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
          productModel: true,
          variants: {
            where: variantWhere,
            include: { size: true, color: true },
            orderBy: [
              { color: { name: 'asc' } },
              { size: { sortOrder: 'asc' } },
              { size: { name: 'asc' } },
            ],
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
      items: products.map((product) => {
        const colorIds = new Set(product.variants.map((variant) => variant.colorId));

        return {
          productId: product.id,
          name: this.buildStyleTitle(
            product.brand.name,
            product.productModel?.name ?? null,
            product.reference,
          ),
          reference: product.reference,
          description: product.description,
          category: product.category.name,
          categorySlug: product.category.name,
          brand: product.brand.name,
          model: product.productModel?.name ?? null,
          imageUrl: this.resolvePublicProductImage(product, product.variants),
          colorCount: colorIds.size,
          sizeCount: new Set(product.variants.map((variant) => variant.sizeId)).size,
          variants: product.variants.map((variant) => ({
            id: variant.id,
            size: variant.size.name,
            color: variant.color.name,
            colorId: variant.colorId,
            itemNo: variant.itemNo,
            sku: variant.sku,
            salePrice: Number(variant.salePrice),
            stock: variant.stock,
            imageUrl: this.resolveVariantImage(variant, product),
            status: variant.status,
          })),
        };
      }),
    };
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

  private resolvePublicProductImage(
    product: { imageUrl: string | null },
    variants: { imageUrl: string | null }[] = [],
  ): string | null {
    const productImage = product.imageUrl?.trim();
    if (productImage) return productImage;

    for (const variant of variants) {
      const variantImage = variant.imageUrl?.trim();
      if (variantImage) return variantImage;
    }

    return null;
  }

  private resolveVariantImage(
    variant: { imageUrl: string | null },
    product: { imageUrl: string | null },
  ): string | null {
    return variant.imageUrl?.trim() || product.imageUrl?.trim() || null;
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
        variants: {
          where: variantWhere,
          include: { size: true, color: true },
          orderBy: [
            { color: { name: 'asc' } },
            { size: { sortOrder: 'asc' } },
            { size: { name: 'asc' } },
          ],
        },
      },
    });

    let styles = products
      .filter((product) => product.variants.length > 0)
      .map((product) => {
        const prices = product.variants
          .map((variant) => Number(variant.salePrice))
          .filter((price) => price > 0);

        return {
          styleKey: product.id,
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
          imageUrl: this.resolvePublicProductImage(product, product.variants),
          colorCount: new Set(product.variants.map((variant) => variant.colorId)).size,
          sizeCount: new Set(product.variants.map((variant) => variant.sizeId)).size,
          minPrice: prices.length ? Math.min(...prices) : 0,
          maxPrice: prices.length ? Math.max(...prices) : 0,
          hasStock: product.variants.some((variant) => variant.stock > 0),
          latestCreatedAt: product.createdAt,
          minPriceValue: prices.length ? Math.min(...prices) : null,
        };
      });

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
          color: true,
          product: {
            include: {
              category: true,
              sport: true,
              brand: true,
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

    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId: company.id, isActive: true },
      include: {
        category: true,
        brand: true,
        productModel: true,
        variants: {
          where: { status: ProductStatus.ACTIVE },
          include: { size: true, color: true },
          orderBy: [
            { color: { name: 'asc' } },
            { size: { sortOrder: 'asc' } },
            { size: { name: 'asc' } },
          ],
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (!product.variants.length) {
      throw new NotFoundException('Product has no active variants');
    }

    const colorMap = new Map<
      string,
      {
        colorId: string;
        productId: string;
        color: string;
        reference: string;
        imageUrl: string | null;
        variants: {
          id: string;
          size: string;
          itemNo: string | null;
          sku: string | null;
          salePrice: number;
          stock: number;
          imageUrl: string | null;
          status: ProductStatus;
        }[];
      }
    >();

    for (const variant of product.variants) {
      let entry = colorMap.get(variant.colorId);

      if (!entry) {
        entry = {
          colorId: variant.colorId,
          productId: product.id,
          color: variant.color.name,
          reference: product.reference,
          imageUrl: this.resolveVariantImage(variant, product),
          variants: [],
        };
        colorMap.set(variant.colorId, entry);
      }

      if (!entry.imageUrl) {
        entry.imageUrl = this.resolveVariantImage(variant, product);
      }

      entry.variants.push({
        id: variant.id,
        size: variant.size.name,
        itemNo: variant.itemNo,
        sku: variant.sku,
        salePrice: Number(variant.salePrice),
        stock: variant.stock,
        imageUrl: this.resolveVariantImage(variant, product),
        status: variant.status,
      });
    }

    const colors = Array.from(colorMap.values()).sort((a, b) =>
      a.color.localeCompare(b.color),
    );

    const styleTitle = this.buildStyleTitle(
      product.brand.name,
      product.productModel?.name ?? null,
      product.reference,
    );

    return {
      company,
      productId: product.id,
      styleKey: product.id,
      styleTitle,
      category: product.category.name,
      categorySlug: product.category.name,
      brand: product.brand.name,
      model: product.productModel?.name ?? null,
      colors,
    };
  }

  async getCatalogs(companyId: string) {
    const [categories, sports, brands, colors, models, sizes] =
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
        this.prisma.color.findMany({
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

    return { categories, sports, brands, colors, models, sizes };
  }
}
