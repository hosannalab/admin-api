import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { ListPublicProductsQueryDto } from './dto/list-public-products-query.dto';
import { InventoryService } from './inventory.service';

@Controller('public')
@UseGuards(ApiKeyGuard)
export class PublicProductsController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('products')
  listProducts(
    @Headers('x-company-external-id') companyExternalId: string | undefined,
    @Query() query: ListPublicProductsQueryDto,
  ) {
    if (!companyExternalId) {
      throw new BadRequestException('x-company-external-id header is required');
    }

    return this.inventoryService.listPublicProducts(companyExternalId, query);
  }

  @Get('categories')
  listCategories(
    @Headers('x-company-external-id') companyExternalId: string | undefined,
  ) {
    if (!companyExternalId) {
      throw new BadRequestException('x-company-external-id header is required');
    }

    return this.inventoryService.listPublicCategories(companyExternalId);
  }
}
