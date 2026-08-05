import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { RolesPermissionsGuard } from '../common/guards/roles-permissions.guard';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, RolesPermissionsGuard],
  exports: [CatalogService],
})
export class CatalogModule {}
