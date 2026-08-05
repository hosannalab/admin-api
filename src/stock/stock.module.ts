import { Module } from '@nestjs/common';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';
import { RolesPermissionsGuard } from '../common/guards/roles-permissions.guard';

@Module({
  controllers: [StockController],
  providers: [StockService, RolesPermissionsGuard],
  exports: [StockService],
})
export class StockModule {}
