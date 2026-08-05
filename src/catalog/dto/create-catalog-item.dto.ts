import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateCatalogItemDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
