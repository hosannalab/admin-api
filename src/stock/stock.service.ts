import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  StockMovementReason,
  StockMovementType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStockMovementDto } from './dto/create-stock-movement.dto';
import { ListStockMovementsQueryDto } from './dto/list-stock-movements-query.dto';
import {
  getReasonOptions,
  isReasonAllowedForType,
  REASON_LABELS,
} from './stock-movement-reasons';

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  getReasons(type?: StockMovementType) {
    return getReasonOptions(type);
  }

  private buildWhere(
    companyId: string,
    query: ListStockMovementsQueryDto,
    variantId?: string,
  ): Prisma.StockMovementWhereInput {
    const andFilters: Prisma.StockMovementWhereInput[] = [];

    if (variantId) {
      andFilters.push({ variantId });
    } else if (query.variantId) {
      andFilters.push({ variantId: query.variantId });
    }

    if (query.type) {
      andFilters.push({ type: query.type });
    }

    if (query.reason) {
      andFilters.push({ reason: query.reason });
    }

    if (query.createdById) {
      andFilters.push({ createdById: query.createdById });
    }

    if (query.dateFrom) {
      andFilters.push({ createdAt: { gte: new Date(query.dateFrom) } });
    }

    if (query.dateTo) {
      andFilters.push({ createdAt: { lte: new Date(query.dateTo) } });
    }

    if (query.productId) {
      andFilters.push({ variant: { productId: query.productId } });
    }

    if (query.categoryId) {
      andFilters.push({
        variant: { product: { categoryId: query.categoryId } },
      });
    }

    if (query.brandId) {
      andFilters.push({
        variant: { product: { brandId: query.brandId } },
      });
    }

    return {
      companyId,
      ...(andFilters.length ? { AND: andFilters } : {}),
      ...(query.search
        ? {
            OR: [
              {
                variant: {
                  product: {
                    name: { contains: query.search, mode: 'insensitive' },
                  },
                },
              },
              {
                variant: {
                  product: {
                    reference: { contains: query.search, mode: 'insensitive' },
                  },
                },
              },
              { variant: { itemNo: { contains: query.search, mode: 'insensitive' } } },
              { variant: { sku: { contains: query.search, mode: 'insensitive' } } },
              { note: { contains: query.search, mode: 'insensitive' } },
              { reference: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  private mapMovement(movement: {
    id: string;
    type: StockMovementType;
    reason: StockMovementReason;
    quantity: number;
    stockBefore: number;
    stockAfter: number;
    note: string | null;
    reference: string | null;
    createdAt: Date;
    createdBy: { id: string; firstName: string | null; lastName: string | null; email: string };
    variant: {
      id: string;
      itemNo: string | null;
      sku: string | null;
      size: { name: string };
      color: { name: string };
      product: { id: string; name: string; reference: string };
    };
  }) {
    return {
      id: movement.id,
      type: movement.type,
      reason: movement.reason,
      reasonLabel: REASON_LABELS[movement.reason],
      quantity: movement.quantity,
      stockBefore: movement.stockBefore,
      stockAfter: movement.stockAfter,
      note: movement.note,
      reference: movement.reference,
      createdAt: movement.createdAt,
      createdBy: {
        id: movement.createdBy.id,
        name:
          [movement.createdBy.firstName, movement.createdBy.lastName]
            .filter(Boolean)
            .join(' ') || movement.createdBy.email,
        email: movement.createdBy.email,
      },
      variant: {
        id: movement.variant.id,
        itemNo: movement.variant.itemNo,
        sku: movement.variant.sku,
        size: movement.variant.size,
        color: movement.variant.color,
        product: movement.variant.product,
      },
    };
  }

  async listMovements(companyId: string, query: ListStockMovementsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'desc';
    const where = this.buildWhere(companyId, query);

    const [items, total] = await Promise.all([
      this.prisma.stockMovement.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { [sortBy]: sortOrder },
        include: {
          createdBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          variant: {
            include: {
              size: true,
              color: true,
              product: { select: { id: true, name: true, reference: true } },
            },
          },
        },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      items: items.map((item) => this.mapMovement(item)),
    };
  }

  async listVariantMovements(
    companyId: string,
    variantId: string,
    query: ListStockMovementsQueryDto,
  ) {
    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, companyId },
    });

    if (!variant) {
      throw new NotFoundException('Variant not found');
    }

    return this.listMovements(companyId, { ...query, variantId });
  }

  async getSummary(companyId: string, query: ListStockMovementsQueryDto) {
    const where = this.buildWhere(companyId, query);
    const movements = await this.prisma.stockMovement.findMany({
      where,
      select: { type: true, quantity: true },
    });

    let totalIn = 0;
    let totalOut = 0;

    for (const movement of movements) {
      if (movement.type === StockMovementType.IN) {
        totalIn += movement.quantity;
      } else {
        totalOut += movement.quantity;
      }
    }

    return {
      totalMovements: movements.length,
      totalIn,
      totalOut,
      net: totalIn - totalOut,
    };
  }

  async createMovement(
    companyId: string,
    userId: string,
    dto: CreateStockMovementDto,
  ) {
    if (dto.reason === StockMovementReason.INITIAL) {
      throw new BadRequestException('INITIAL reason is reserved for the system');
    }

    if (!isReasonAllowedForType(dto.type, dto.reason)) {
      throw new BadRequestException('Reason is not valid for this movement type');
    }

    return this.applyMovement(companyId, userId, dto);
  }

  async createInitialMovement(
    companyId: string,
    userId: string,
    variantId: string,
    quantity: number,
  ) {
    if (quantity <= 0) {
      return null;
    }

    return this.applyMovement(companyId, userId, {
      variantId,
      type: StockMovementType.IN,
      reason: StockMovementReason.INITIAL,
      quantity,
    });
  }

  private async applyMovement(
    companyId: string,
    userId: string,
    dto: {
      variantId: string;
      type: StockMovementType;
      reason: StockMovementReason;
      quantity: number;
      note?: string;
      reference?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.findFirst({
        where: { id: dto.variantId, companyId },
      });

      if (!variant) {
        throw new NotFoundException('Variant not found');
      }

      const stockBefore = variant.stock;
      const stockAfter =
        dto.type === StockMovementType.IN
          ? stockBefore + dto.quantity
          : stockBefore - dto.quantity;

      if (stockAfter < 0) {
        throw new BadRequestException('La salida excede el stock disponible');
      }

      const movement = await tx.stockMovement.create({
        data: {
          companyId,
          variantId: dto.variantId,
          type: dto.type,
          reason: dto.reason,
          quantity: dto.quantity,
          stockBefore,
          stockAfter,
          note: dto.note,
          reference: dto.reference,
          createdById: userId,
        },
        include: {
          createdBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          variant: {
            include: {
              size: true,
              color: true,
              product: { select: { id: true, name: true, reference: true } },
            },
          },
        },
      });

      await tx.productVariant.update({
        where: { id: dto.variantId },
        data: { stock: stockAfter },
      });

      return this.mapMovement(movement);
    });
  }

  async adjustLegacy(
    companyId: string,
    userId: string,
    variantId: string,
    movementType: 'IN' | 'OUT',
    quantity: number,
  ) {
    return this.createMovement(companyId, userId, {
      variantId,
      type: movementType as StockMovementType,
      reason:
        movementType === 'IN'
          ? StockMovementReason.POSITIVE_ADJUSTMENT
          : StockMovementReason.NEGATIVE_ADJUSTMENT,
      quantity,
    });
  }
}
