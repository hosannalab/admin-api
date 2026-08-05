import { StockMovementReason, StockMovementType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListStockMovementsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;

  @IsOptional()
  @IsIn(['IN', 'OUT'])
  type?: StockMovementType;

  @IsOptional()
  @IsIn([
    'INITIAL',
    'PURCHASE',
    'CUSTOMER_RETURN',
    'POSITIVE_ADJUSTMENT',
    'SALE',
    'SUPPLIER_RETURN',
    'DAMAGE',
    'NEGATIVE_ADJUSTMENT',
  ])
  reason?: StockMovementReason;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  brandId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  createdById?: string;

  @IsOptional()
  @IsIn(['createdAt', 'quantity'])
  sortBy?: 'createdAt' | 'quantity' = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
