import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesPermissionsGuard } from '../common/guards/roles-permissions.guard';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { CatalogService } from './catalog.service';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto';
import { ListCatalogQueryDto } from './dto/list-catalog-query.dto';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto';

@Controller('inventory/catalogs')
@UseGuards(JwtAuthGuard, RolesPermissionsGuard)
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('resources')
  @Permissions('catalog.read')
  listResources() {
    return this.catalogService.listResources();
  }

  @Get(':resource')
  @Permissions('catalog.read')
  list(
    @CurrentUser() user: JwtPayload,
    @Param('resource') resource: string,
    @Query() query: ListCatalogQueryDto,
  ) {
    return this.catalogService.list(user.companyId, resource, query);
  }

  @Get(':resource/:id')
  @Permissions('catalog.read')
  getById(
    @CurrentUser() user: JwtPayload,
    @Param('resource') resource: string,
    @Param('id') id: string,
  ) {
    return this.catalogService.getById(user.companyId, resource, id);
  }

  @Post(':resource')
  @Permissions('catalog.create')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('resource') resource: string,
    @Body() dto: CreateCatalogItemDto,
  ) {
    return this.catalogService.create(user.companyId, resource, dto);
  }

  @Patch(':resource/:id')
  @Permissions('catalog.update')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('resource') resource: string,
    @Param('id') id: string,
    @Body() dto: UpdateCatalogItemDto,
  ) {
    return this.catalogService.update(user.companyId, resource, id, dto);
  }

  @Patch(':resource/:id/toggle')
  @Permissions('catalog.inactivate')
  toggle(
    @CurrentUser() user: JwtPayload,
    @Param('resource') resource: string,
    @Param('id') id: string,
  ) {
    return this.catalogService.toggle(user.companyId, resource, id);
  }
}
