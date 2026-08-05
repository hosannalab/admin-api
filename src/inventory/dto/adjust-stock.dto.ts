import { Type } from 'class-transformer';
import { IsIn, IsInt, Min } from 'class-validator';

export class AdjustStockDto {
  @IsIn(['IN', 'OUT'])
  movementType!: 'IN' | 'OUT';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}
