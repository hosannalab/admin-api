import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesPermissionsGuard } from '../common/guards/roles-permissions.guard';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { StockService } from '../stock/stock.service';
import { ListStockMovementsQueryDto } from '../stock/dto/list-stock-movements-query.dto';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { ListVariantsQueryDto } from './dto/list-variants-query.dto';
import { UpdateVariantDto } from './dto/update-variant.dto';
import { InventoryService } from './inventory.service';
import { ProductsService } from './products.service';

@Controller('inventory')
@UseGuards(JwtAuthGuard, RolesPermissionsGuard)
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly productsService: ProductsService,
    private readonly stockService: StockService,
  ) {}

  @Get('variants')
  @Permissions('product.read')
  listVariants(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListVariantsQueryDto,
  ) {
    return this.inventoryService.listVariants(user.companyId, query);
  }

  @Get('catalogs')
  @Permissions('catalog.read')
  getCatalogs(@CurrentUser() user: JwtPayload) {
    return this.inventoryService.getCatalogs(user.companyId);
  }

  @Patch('variants/:id')
  @Permissions('product.update')
  updateVariant(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateVariantDto,
  ) {
    return this.productsService.updateVariant(user.companyId, id, dto);
  }

  @Patch('variants/:id/inactivate')
  @Permissions('product.inactivate')
  inactivateVariant(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.productsService.inactivateVariant(user.companyId, id);
  }

  @Patch('variants/:id/activate')
  @Permissions('product.update')
  activateVariant(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.productsService.activateVariant(user.companyId, id);
  }

  @Patch('variants/:id/stock')
  @Permissions('stock.move')
  adjustVariantStock(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AdjustStockDto,
  ) {
    return this.stockService.adjustLegacy(
      user.companyId,
      user.sub,
      id,
      dto.movementType,
      dto.quantity,
    );
  }

  @Get('variants/:id/movements')
  @Permissions('stock.read')
  listVariantMovements(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query() query: ListStockMovementsQueryDto,
  ) {
    return this.stockService.listVariantMovements(user.companyId, id, query);
  }
}
