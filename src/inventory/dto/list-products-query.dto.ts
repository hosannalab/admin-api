import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListProductsQueryDto {
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
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  brandId?: string;

  @IsOptional()
  @IsString()
  sportId?: string;

  @IsOptional()
  @IsString()
  colorId?: string;

  @IsOptional()
  @IsString()
  productModelId?: string;

  @IsOptional()
  @IsIn(['true', 'false'])
  isActive?: string;

  @IsOptional()
  @IsIn(['createdAt', 'name', 'reference'])
  sortBy?: 'createdAt' | 'name' | 'reference' = 'createdAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc' = 'desc';
}
