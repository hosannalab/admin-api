import {
  BadRequestException,
  Body,
  Controller,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Query,
  StreamableFile,
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
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { CreateVariantDto, UpdateProductDto } from './dto/update-product.dto';
import { ProductImportService } from './product-import.service';
import { ProductsService } from './products.service';

const IMPORT_MAX_FILE_SIZE = 5 * 1024 * 1024;

@Controller('inventory/products')
@UseGuards(JwtAuthGuard, RolesPermissionsGuard)
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly productImportService: ProductImportService,
  ) {}

  @Get()
  @Permissions('product.read')
  listProducts(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListProductsQueryDto,
  ) {
    return this.productsService.listProducts(user.companyId, query);
  }

  @Get('import/template')
  @Permissions('product.read')
  async downloadImportTemplate(@CurrentUser() user: JwtPayload) {
    const buffer = await this.productImportService.buildTemplate(user.companyId);
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="productos-plantilla.xlsx"',
    });
  }

  @Post('import')
  @Permissions('product.create', 'product.update')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: IMPORT_MAX_FILE_SIZE },
    }),
  )
  importProducts(
    @CurrentUser() user: JwtPayload,
    @UploadedFile(
      new ParseFilePipe({
        fileIsRequired: true,
        validators: [new MaxFileSizeValidator({ maxSize: IMPORT_MAX_FILE_SIZE })],
        exceptionFactory: () =>
          new BadRequestException('Debes adjuntar un archivo Excel de hasta 5 MB'),
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.productImportService.importFile(user.companyId, user.sub, file);
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
