import { Module } from '@nestjs/common';
import { StorageController } from './storage.controller';
import { PublicMediaController } from './public-media.controller';
import { StorageService } from './storage.service';
import { RolesPermissionsGuard } from '../common/guards/roles-permissions.guard';

@Module({
  controllers: [StorageController, PublicMediaController],
  providers: [StorageService, RolesPermissionsGuard],
  exports: [StorageService],
})
export class StorageModule {}
