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
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { CreateVariantDto, UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@Controller('inventory/products')
@UseGuards(JwtAuthGuard, RolesPermissionsGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @Permissions('product.read')
  listProducts(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListProductsQueryDto,
  ) {
    return this.productsService.listProducts(user.companyId, query);
  }

  @Get(':id')
  @Permissions('product.read')
  getProduct(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.productsService.getProduct(user.companyId, id);
  }

  @Post()
  @Permissions('product.create')
  createProduct(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateProductDto,
  ) {
    return this.productsService.createProduct(user.companyId, user.sub, dto);
  }

  @Patch(':id')
  @Permissions('product.update')
  updateProduct(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.productsService.updateProduct(user.companyId, id, dto);
  }

  @Patch(':id/toggle')
  @Permissions('product.inactivate')
  toggleProduct(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.productsService.toggleProduct(user.companyId, id);
  }

  @Post(':id/variants')
  @Permissions('product.create')
  createVariant(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateVariantDto,
  ) {
    return this.productsService.createVariantForProduct(
      user.companyId,
      user.sub,
      id,
      dto,
    );
  }
}
