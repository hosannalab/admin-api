import { StockMovementReason, StockMovementType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateStockMovementDto {
  @IsString()
  variantId!: string;

  @IsEnum(StockMovementType)
  type!: StockMovementType;

  @IsEnum(StockMovementReason)
  reason!: StockMovementReason;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}
