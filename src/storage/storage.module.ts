import { Module } from '@nestjs/common';
import { StorageController } from './storage.controller';
import { StorageService } from './storage.service';
import { RolesPermissionsGuard } from '../common/guards/roles-permissions.guard';

@Module({
  controllers: [StorageController],
  providers: [StorageService, RolesPermissionsGuard],
  exports: [StorageService],
})
export class StorageModule {}
