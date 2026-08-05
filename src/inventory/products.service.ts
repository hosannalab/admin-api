import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockService } from '../stock/stock.service';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateVariantDto, UpdateProductDto } from './dto/update-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
  ) {}

  private productInclude = {
    category: true,
    sport: true,
    brand: true,
    productType: true,
    productModel: true,
    variants: {
      include: { size: true },
      orderBy: { createdAt: 'asc' as const },
    },
  };

  private mapProductSummary(product: {
    id: string;
    reference: string;
    name: string;
    imageUrl: string | null;
    isActive: boolean;
    createdAt: Date;
    category: { id: string; name: string };
    brand: { id: string; name: string };
    variants: { stock: number; salePrice: Prisma.Decimal; status: ProductStatus }[];
  }) {
    const activeVariants = product.variants.filter(
      (variant) => variant.status === ProductStatus.ACTIVE,
    );
    const prices = activeVariants.map((variant) => Number(variant.salePrice));

    return {
      id: product.id,
      reference: product.reference,
      name: product.name,
      imageUrl: product.imageUrl,
      isActive: product.isActive,
      createdAt: product.createdAt,
      category: product.category,
      brand: product.brand,
      variantsCount: product.variants.length,
      totalStock: product.variants.reduce((sum, variant) => sum + variant.stock, 0),
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
    };
  }

  async listProducts(companyId: string, query: ListProductsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';

    const where: Prisma.ProductWhereInput = {
      companyId,
      ...(query.isActive !== undefined
        ? { isActive: query.isActive === 'true' }
        : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.sportId ? { sportId: query.sportId } : {}),
      ...(query.productTypeId ? { productTypeId: query.productTypeId } : {}),
      ...(query.productModelId ? { productModelId: query.productModelId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { reference: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
        include: {
          category: { select: { id: true, name: true } },
          brand: { select: { id: true, name: true } },
          variants: { select: { stock: true, salePrice: true, status: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      items: items.map((item) => this.mapProductSummary(item)),
    };
  }

  async getProduct(companyId: string, id: string) {
    const product = await this.prisma.product.findFirst({
      where: { id, companyId },
      include: this.productInclude,
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return {
      ...product,
      variants: product.variants.map((variant) => ({
        ...variant,
        salePrice: Number(variant.salePrice),
      })),
    };
  }

  async createProduct(
    companyId: string,
    userId: string,
    dto: CreateProductDto,
  ) {
    await this.ensureProductForeignKeys(companyId, dto);

    try {
      const product = await this.prisma.product.create({
        data: {
          companyId,
          reference: dto.reference.trim(),
          name: dto.name.trim(),
          description: dto.description,
          categoryId: dto.categoryId,
          sportId: dto.sportId || null,
          brandId: dto.brandId,
          productTypeId: dto.productTypeId || null,
          productModelId: dto.productModelId || null,
          imageUrl: dto.imageUrl,
        },
        include: this.productInclude,
      });

      if (dto.sizeId) {
        if (dto.salePrice === undefined || dto.stock === undefined) {
          throw new BadRequestException(
            'salePrice and stock are required when creating a variant',
          );
        }

        await this.createVariantForProduct(companyId, userId, product.id, {
          sizeId: dto.sizeId,
          itemNo: dto.itemNo,
          sku: dto.sku,
          salePrice: dto.salePrice,
          stock: dto.stock,
          imageUrl: dto.imageUrl,
          status: dto.status,
        });
      }

      return this.getProduct(companyId, product.id);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ya existe un producto con esa referencia');
      }
      throw error;
    }
  }

  async updateProduct(companyId: string, id: string, dto: UpdateProductDto) {
    const existing = await this.prisma.product.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    await this.ensureProductForeignKeys(companyId, {
      categoryId: dto.categoryId ?? existing.categoryId,
      brandId: dto.brandId ?? existing.brandId,
      sportId: dto.sportId ?? existing.sportId ?? undefined,
      productTypeId: dto.productTypeId ?? existing.productTypeId ?? undefined,
      productModelId: dto.productModelId ?? existing.productModelId ?? undefined,
    });

    try {
      await this.prisma.product.update({
        where: { id },
        data: {
          ...(dto.reference !== undefined ? { reference: dto.reference.trim() } : {}),
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
          ...(dto.brandId !== undefined ? { brandId: dto.brandId } : {}),
          ...(dto.sportId !== undefined ? { sportId: dto.sportId || null } : {}),
          ...(dto.productTypeId !== undefined
            ? { productTypeId: dto.productTypeId || null }
            : {}),
          ...(dto.productModelId !== undefined
            ? { productModelId: dto.productModelId || null }
            : {}),
          ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });

      return this.getProduct(companyId, id);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ya existe un producto con esa referencia');
      }
      throw error;
    }
  }

  async toggleProduct(companyId: string, id: string) {
    const existing = await this.prisma.product.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    await this.prisma.product.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });

    return this.getProduct(companyId, id);
  }

  async createVariantForProduct(
    companyId: string,
    userId: string,
    productId: string,
    dto: CreateVariantDto,
  ) {
    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    const size = await this.prisma.size.findFirst({
      where: { id: dto.sizeId, companyId, isActive: true },
    });

    if (!size) {
      throw new BadRequestException('Invalid size for this company');
    }

    try {
      const variant = await this.prisma.productVariant.create({
        data: {
          companyId,
          productId,
          sizeId: dto.sizeId,
          itemNo: dto.itemNo,
          sku: dto.sku,
          salePrice: dto.salePrice,
          stock: 0,
          status: dto.status ?? ProductStatus.ACTIVE,
          imageUrl: dto.imageUrl ?? product.imageUrl,
        },
      });

      if (dto.stock > 0) {
        await this.stockService.createInitialMovement(
          companyId,
          userId,
          variant.id,
          dto.stock,
        );
      }

      return this.getProduct(companyId, productId);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Duplicate unique value in variant');
      }
      throw error;
    }
  }

  async updateVariant(companyId: string, id: string, dto: UpdateVariantDto) {
    const existing = await this.prisma.productVariant.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new NotFoundException('Variant not found');
    }

    const updated = await this.prisma.productVariant.update({
      where: { id },
      data: {
        ...(dto.salePrice !== undefined ? { salePrice: dto.salePrice } : {}),
        ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
        ...(dto.itemNo !== undefined ? { itemNo: dto.itemNo } : {}),
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
      },
      include: {
        size: true,
        product: true,
      },
    });

    return {
      ...updated,
      salePrice: Number(updated.salePrice),
    };
  }

  async inactivateVariant(companyId: string, id: string) {
    return this.setVariantStatus(companyId, id, ProductStatus.INACTIVE);
  }

  async activateVariant(companyId: string, id: string) {
    return this.setVariantStatus(companyId, id, ProductStatus.ACTIVE);
  }

  private async setVariantStatus(
    companyId: string,
    id: string,
    status: ProductStatus,
  ) {
    const existing = await this.prisma.productVariant.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new NotFoundException('Variant not found');
    }

    const updated = await this.prisma.productVariant.update({
      where: { id },
      data: { status },
      include: { size: true, product: true },
    });

    return {
      ...updated,
      salePrice: Number(updated.salePrice),
    };
  }

  private async ensureProductForeignKeys(
    companyId: string,
    dto: {
      categoryId: string;
      brandId: string;
      sportId?: string;
      productTypeId?: string;
      productModelId?: string;
    },
  ) {
    const [category, brand] = await Promise.all([
      this.prisma.category.findFirst({
        where: { id: dto.categoryId, companyId, isActive: true },
      }),
      this.prisma.brand.findFirst({
        where: { id: dto.brandId, companyId, isActive: true },
      }),
    ]);

    if (!category || !brand) {
      throw new BadRequestException('Invalid category or brand for this company');
    }

    const optionalChecks = [
      dto.sportId
        ? this.prisma.sport.findFirst({
            where: { id: dto.sportId, companyId, isActive: true },
          })
        : Promise.resolve(true),
      dto.productTypeId
        ? this.prisma.productType.findFirst({
            where: { id: dto.productTypeId, companyId, isActive: true },
          })
        : Promise.resolve(true),
      dto.productModelId
        ? this.prisma.productModel.findFirst({
            where: { id: dto.productModelId, companyId, isActive: true },
          })
        : Promise.resolve(true),
    ];

    const results = await Promise.all(optionalChecks);
    if (results.some((result) => result === null)) {
      throw new BadRequestException('Invalid catalog references for this company');
    }
  }
}
