import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesPermissionsGuard } from '../common/guards/roles-permissions.guard';
import type { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { StockMovementType } from '@prisma/client';
import { CreateStockMovementDto } from './dto/create-stock-movement.dto';
import { ListStockMovementsQueryDto } from './dto/list-stock-movements-query.dto';
import { StockService } from './stock.service';

@Controller('inventory/movements')
@UseGuards(JwtAuthGuard, RolesPermissionsGuard)
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get('reasons')
  @Permissions('stock.read')
  getReasons(@Query('type') type?: StockMovementType) {
    return this.stockService.getReasons(type);
  }

  @Get('summary')
  @Permissions('stock.read')
  getSummary(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListStockMovementsQueryDto,
  ) {
    return this.stockService.getSummary(user.companyId, query);
  }

  @Get()
  @Permissions('stock.read')
  listMovements(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListStockMovementsQueryDto,
  ) {
    return this.stockService.listMovements(user.companyId, query);
  }

  @Post()
  @Permissions('stock.move')
  createMovement(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateStockMovementDto,
  ) {
    return this.stockService.createMovement(user.companyId, user.sub, dto);
  }
}