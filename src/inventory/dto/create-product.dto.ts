import { ProductStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateProductDto {
  @IsString()
  @IsNotEmpty()
  reference!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @IsNotEmpty()
  categoryId!: string;

  @IsOptional()
  @IsString()
  sportId?: string;

  @IsString()
  @IsNotEmpty()
  brandId!: string;

  @IsOptional()
  @IsString()
  productModelId?: string;

  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  sizeId?: string;

  @ValidateIf((dto) => Boolean(dto.sizeId))
  @IsString()
  @IsNotEmpty()
  colorId?: string;

  @ValidateIf((dto) => Boolean(dto.sizeId))
  @IsString()
  @IsNotEmpty()
  itemNo?: string;

  @ValidateIf((dto) => Boolean(dto.sizeId))
  @IsOptional()
  @IsString()
  sku?: string;

  @ValidateIf((dto) => Boolean(dto.sizeId))
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  salePrice?: number;

  @ValidateIf((dto) => Boolean(dto.sizeId))
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}
