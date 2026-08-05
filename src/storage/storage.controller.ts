import {
  Controller,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesPermissionsGuard } from '../common/guards/roles-permissions.guard';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { StorageService } from './storage.service';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

@Controller('storage')
@UseGuards(JwtAuthGuard, RolesPermissionsGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('products/:productId/image')
  @Permissions('product.update')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  uploadProductImage(
    @CurrentUser() user: JwtPayload,
    @Param('productId') productId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE })],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.storageService.uploadProductImage(
      user.companyId,
      productId,
      file,
    );
  }

  @Post('variants/:variantId/image')
  @Permissions('product.update')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_FILE_SIZE },
    }),
  )
  uploadVariantImage(
    @CurrentUser() user: JwtPayload,
    @Param('variantId') variantId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE })],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.storageService.uploadVariantImage(
      user.companyId,
      variantId,
      file,
    );
  }
}
