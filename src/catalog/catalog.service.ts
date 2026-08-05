import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CATALOG_RESOURCES, resolveCatalogResource } from './catalog.config';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto';
import { ListCatalogQueryDto } from './dto/list-catalog-query.dto';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  private getDelegate(model: string) {
    const delegate = (this.prisma as unknown as Record<string, unknown>)[model] as {
      findMany: (args: unknown) => Promise<unknown[]>;
      findFirst: (args: unknown) => Promise<Record<string, unknown> | null>;
      count: (args: unknown) => Promise<number>;
      create: (args: unknown) => Promise<unknown>;
      update: (args: unknown) => Promise<unknown>;
    };

    if (!delegate) {
      throw new BadRequestException('Invalid catalog resource');
    }

    return delegate;
  }

  private buildOrderBy(
    resource: string,
    sortBy: ListCatalogQueryDto['sortBy'],
    sortOrder: Prisma.SortOrder,
  ) {
    if (resource === 'sizes' && sortBy === 'sortOrder') {
      return [{ sortOrder }, { name: sortOrder }];
    }

    return { [sortBy ?? 'name']: sortOrder };
  }

  async list(companyId: string, resource: string, query: ListCatalogQueryDto) {
    const resolved = resolveCatalogResource(resource);
    if (!resolved) {
      throw new NotFoundException('Catalog resource not found');
    }

    const delegate = this.getDelegate(resolved.config.model);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;
    const sortOrder: Prisma.SortOrder = query.sortOrder ?? 'asc';

    const where: Record<string, unknown> = {
      companyId,
      ...(query.isActive !== undefined
        ? { isActive: query.isActive === 'true' }
        : {}),
      ...(query.search
        ? {
            name: {
              contains: query.search,
              mode: 'insensitive',
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      delegate.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: this.buildOrderBy(resource, query.sortBy, sortOrder),
      }),
      delegate.count({ where }),
    ]);

    return {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      items,
    };
  }

  async getById(companyId: string, resource: string, id: string) {
    const resolved = resolveCatalogResource(resource);
    if (!resolved) {
      throw new NotFoundException('Catalog resource not found');
    }

    const delegate = this.getDelegate(resolved.config.model);
    const item = await delegate.findFirst({
      where: { id, companyId },
    });

    if (!item) {
      throw new NotFoundException(`${resolved.config.label} not found`);
    }

    return item;
  }

  async create(companyId: string, resource: string, dto: CreateCatalogItemDto) {
    const resolved = resolveCatalogResource(resource);
    if (!resolved) {
      throw new NotFoundException('Catalog resource not found');
    }

    const delegate = this.getDelegate(resolved.config.model);

    try {
      return await delegate.create({
        data: {
          companyId,
          name: dto.name.trim(),
          ...(resolved.config.model === 'size'
            ? { sortOrder: dto.sortOrder ?? 0 }
            : {}),
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `Ya existe un registro con el nombre "${dto.name}"`,
        );
      }
      throw error;
    }
  }

  async update(
    companyId: string,
    resource: string,
    id: string,
    dto: UpdateCatalogItemDto,
  ) {
    const resolved = resolveCatalogResource(resource);
    if (!resolved) {
      throw new NotFoundException('Catalog resource not found');
    }

    const delegate = this.getDelegate(resolved.config.model);
    const existing = await delegate.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new NotFoundException(`${resolved.config.label} not found`);
    }

    try {
      return await delegate.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ya existe un registro con ese nombre');
      }
      throw error;
    }
  }

  async toggle(companyId: string, resource: string, id: string) {
    const resolved = resolveCatalogResource(resource);
    if (!resolved) {
      throw new NotFoundException('Catalog resource not found');
    }

    const delegate = this.getDelegate(resolved.config.model);
    const existing = await delegate.findFirst({
      where: { id, companyId },
    });

    if (!existing) {
      throw new NotFoundException(`${resolved.config.label} not found`);
    }

    return delegate.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });
  }

  listResources() {
    return Object.values(CATALOG_RESOURCES).map((resource) => ({
      path: resource.path,
      label: resource.label,
    }));
  }
}
