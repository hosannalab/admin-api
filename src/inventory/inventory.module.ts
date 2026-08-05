import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { ProductsController } from './products.controller';
import { PublicProductsController } from './public-products.controller';
import { InventoryService } from './inventory.service';
import { ProductsService } from './products.service';
import { RolesPermissionsGuard } from '../common/guards/roles-permissions.guard';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [StockModule],
  controllers: [InventoryController, ProductsController, PublicProductsController],
  providers: [InventoryService, ProductsService, RolesPermissionsGuard, ApiKeyGuard],
})
export class InventoryModule {}
