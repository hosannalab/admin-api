import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';
import { ProductStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reference?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  sportId?: string;

  @IsOptional()
  @IsString()
  brandId?: string;

  @IsOptional()
  @IsString()
  productModelId?: string;

  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @IsOptional()
  isActive?: boolean;
}

export class CreateVariantDto {
  @IsString()
  @IsNotEmpty()
  colorId!: string;

  @IsString()
  @IsNotEmpty()
  sizeId!: string;

  @IsString()
  @IsNotEmpty()
  itemNo!: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  salePrice!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock!: number;

  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}
