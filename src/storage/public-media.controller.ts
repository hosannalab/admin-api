import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  StreamableFile,
} from '@nestjs/common';
import type { Readable } from 'stream';
import { StorageService } from './storage.service';

@Controller('public/media')
export class PublicMediaController {
  constructor(private readonly storageService: StorageService) {}

  @Get(':companyId/:scope/:entityId/:file')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  async getObject(
    @Param('companyId') companyId: string,
    @Param('scope') scope: string,
    @Param('entityId') entityId: string,
    @Param('file') file: string,
  ) {
    const key = `${companyId}/${scope}/${entityId}/${file}`;
    const object = await this.storageService.getObject(key);
    const body = object.Body as Readable | undefined;

    if (!body) {
      throw new NotFoundException('Imagen no encontrada.');
    }

    return new StreamableFile(body, {
      type: object.ContentType || 'application/octet-stream',
      length: object.ContentLength,
    });
  }
}
