import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import {
  Prisma,
  ProductStatus,
  StockMovementReason,
  StockMovementType,
} from '@prisma/client';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';
import { allocateItemNumbers, allocateProductReferences } from './product-codes';

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const PRODUCT_COLUMNS = [
  'Referencia',
  'Nombre',
  'Descripcion',
  'Categoria',
  'Marca',
  'Deporte',
  'Modelo',
  'Color',
  'Talla',
  'No',
  'SKU',
  'Precio venta',
  'Inventario',
  'Estatus',
  'Imagen',
] as const;

const HEADER_ALIASES: Record<string, string[]> = {
  reference: ['referencia'],
  name: ['nombre'],
  description: ['descripcion', 'descripción'],
  category: ['categoria', 'categoría'],
  brand: ['marca', 'equipo | marca', 'equipo|marca'],
  sport: ['deporte'],
  model: ['modelo'],
  color: ['color', 'tipo'],
  size: ['talla', 'size'],
  itemNo: ['no'],
  sku: ['sku'],
  salePrice: ['precio venta', 'precio'],
  stock: ['inventario', 'stock'],
  status: ['estatus', 'estado'],
  imageUrl: ['imagen', 'image'],
};

type CatalogMaps = {
  categories: Map<string, { id: string; name: string }>;
  brands: Map<string, { id: string; name: string }>;
  colors: Map<string, { id: string; name: string }>;
  sizes: Map<string, { id: string; name: string }>;
  sports: Map<string, { id: string; name: string }>;
  models: Map<string, { id: string; name: string }>;
};

type ParsedRow = {
  excelRow: number;
  reference: string;
  name: string;
  description: string | null;
  categoryId: string;
  brandId: string;
  sportId: string | null;
  productModelId: string | null;
  colorId: string;
  sizeId: string;
  itemNo: string;
  sku: string;
  salePrice: number;
  stock: number;
  status: ProductStatus;
  imageUrl: string | null;
};

type ImportError = { row: number; message: string };

type ImportSummary = {
  createdProducts: number;
  updatedProducts: number;
  createdVariants: number;
  updatedVariants: number;
  failed: number;
  errors: ImportError[];
};

@Injectable()
export class ProductImportService {
  constructor(private readonly prisma: PrismaService) {}

  async buildTemplate(companyId: string): Promise<Buffer> {
    const catalogs = await this.loadCatalogs(companyId);
    const workbook = XLSX.utils.book_new();

    const instructions = [
      ['Carga masiva de productos — Spot Deportivo Pro'],
      [''],
      ['1. Completa la hoja Productos. Cada fila es una variante (color + talla).'],
      ['2. Varias filas con la misma Referencia (o el mismo Nombre + Categoria + Marca si dejas Referencia vacía) forman un solo producto.'],
      ['3. Referencia y No se generan solos si los dejas vacíos (P-000001 y C-000001). Llénalos solo si quieres un código propio o actualizar un producto existente.'],
      ['4. Categoria, Marca, Color y Talla son obligatorios y deben coincidir con las hojas de catálogo.'],
      ['5. Deporte y Modelo son opcionales, pero si los llenas también deben existir en catálogo.'],
      ['6. No se crean catálogos nuevos desde este Excel: si un valor no aparece, agrégalo primero en Inventario > Catálogos.'],
      ['7. Estatus acepta ACTIVO o INACTIVO. Si lo dejas vacío, queda ACTIVO.'],
      ['8. Imagen debe ser una URL http(s). Las fotos de archivo se suben en el detalle del producto.'],
      ['9. Si la referencia o el No ya existen, se actualizan precio, stock y datos del producto.'],
    ];
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(instructions),
      'Instrucciones',
    );

    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([ [...PRODUCT_COLUMNS] ]),
      'Productos',
    );

    this.appendCatalogSheet(workbook, 'Categorias', catalogs.categories);
    this.appendCatalogSheet(workbook, 'Marcas', catalogs.brands);
    this.appendCatalogSheet(workbook, 'Colores', catalogs.colors);
    this.appendCatalogSheet(workbook, 'Tallas', catalogs.sizes);
    this.appendCatalogSheet(workbook, 'Deportes', catalogs.sports);
    this.appendCatalogSheet(workbook, 'Modelos', catalogs.models);

    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  async importFile(
    companyId: string,
    userId: string,
    file: Express.Multer.File,
  ): Promise<ImportSummary> {
    this.assertSpreadsheet(file);

    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames.find(
      (name) => this.normalizeKey(name) === 'PRODUCTOS',
    );

    if (!sheetName) {
      throw new BadRequestException(
        'El archivo debe incluir una hoja llamada Productos',
      );
    }

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
      header: 1,
      raw: true,
      defval: '',
    });

    const headerRowIndex = matrix.findIndex(
      (row) =>
        Array.isArray(row) &&
        row.some((cell) => {
          const key = this.normalizeKey(cell);
          return key === 'REFERENCIA' || key === 'NOMBRE';
        }),
    );

    if (headerRowIndex < 0) {
      throw new BadRequestException(
        'No se encontraron las columnas de la plantilla en la hoja Productos',
      );
    }

    const headers = (matrix[headerRowIndex] || []).map((cell) => String(cell ?? ''));
    const fieldIndex = this.resolveHeaderIndex(headers);
    const catalogs = await this.loadCatalogs(companyId);
    const errors: ImportError[] = [];
    const parsed: ParsedRow[] = [];

    for (let index = headerRowIndex + 1; index < matrix.length; index += 1) {
      const excelRow = index + 1;
      const raw = matrix[index];
      if (!Array.isArray(raw) || this.isEmptyRow(raw)) {
        continue;
      }

      const result = this.parseRow(excelRow, raw, fieldIndex, catalogs);
      if ('message' in result) {
        errors.push({ row: excelRow, message: result.message });
      } else {
        parsed.push(result);
      }
    }

    this.collectFileDuplicates(parsed, errors);

    const validRows = parsed.filter(
      (row) => !errors.some((error) => error.row === row.excelRow),
    );

    const groups = new Map<string, ParsedRow[]>();
    for (const row of validRows) {
      const key = this.productGroupKey(row);
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }

    this.collectGroupConflicts(groups, errors);

    const rowsToImport = validRows.filter(
      (row) => !errors.some((error) => error.row === row.excelRow),
    );

    const summary: ImportSummary = {
      createdProducts: 0,
      updatedProducts: 0,
      createdVariants: 0,
      updatedVariants: 0,
      failed: 0,
      errors,
    };

    const importGroups = new Map<string, ParsedRow[]>();
    for (const row of rowsToImport) {
      const key = this.productGroupKey(row);
      const list = importGroups.get(key) ?? [];
      list.push(row);
      importGroups.set(key, list);
    }

    for (const group of importGroups.values()) {
      try {
        const result = await this.upsertProductGroup(companyId, userId, group);
        summary.createdProducts += result.createdProduct ? 1 : 0;
        summary.updatedProducts += result.createdProduct ? 0 : 1;
        summary.createdVariants += result.createdVariants;
        summary.updatedVariants += result.updatedVariants;
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'No se pudo importar el producto';
        for (const row of group) {
          errors.push({ row: row.excelRow, message });
        }
      }
    }

    summary.errors = errors.sort((a, b) => a.row - b.row);
    summary.failed = new Set(summary.errors.map((error) => error.row)).size;
    return summary;
  }

  private appendCatalogSheet(
    workbook: XLSX.WorkBook,
    name: string,
    items: Map<string, { name: string }>,
  ) {
    const rows: string[][] = [['Nombre']];
    for (const item of items.values()) {
      rows.push([item.name]);
    }
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }

  private async loadCatalogs(companyId: string): Promise<CatalogMaps> {
    const [categories, brands, colors, sizes, sports, models] =
      await this.prisma.$transaction([
        this.prisma.category.findMany({
          where: { companyId, isActive: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.brand.findMany({
          where: { companyId, isActive: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.color.findMany({
          where: { companyId, isActive: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.size.findMany({
          where: { companyId, isActive: true },
          select: { id: true, name: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        }),
        this.prisma.sport.findMany({
          where: { companyId, isActive: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        this.prisma.productModel.findMany({
          where: { companyId, isActive: true },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
      ]);

    return {
      categories: this.toNameMap(categories),
      brands: this.toNameMap(brands),
      colors: this.toNameMap(colors),
      sizes: this.toNameMap(sizes),
      sports: this.toNameMap(sports),
      models: this.toNameMap(models),
    };
  }

  private toNameMap(items: { id: string; name: string }[]) {
    const map = new Map<string, { id: string; name: string }>();
    for (const item of items) {
      map.set(this.normalizeKey(item.name), item);
    }
    return map;
  }

  private assertSpreadsheet(file?: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Debes adjuntar un archivo Excel');
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('El archivo no puede superar 5 MB');
    }

    const name = this.normalizeKey(file.originalname || '');
    if (!name.endsWith('.XLSX') && !name.endsWith('.XLS')) {
      throw new BadRequestException('El archivo debe ser .xlsx o .xls');
    }
  }

  private resolveHeaderIndex(headers: string[]) {
    const normalized = headers.map((header) => this.normalizeKey(header));
    const indexByField: Record<string, number> = {};

    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      const aliasKeys = aliases.map((alias) => this.normalizeKey(alias));
      const matchIndex = normalized.findIndex((header) => aliasKeys.includes(header));
      if (matchIndex >= 0) {
        indexByField[field] = matchIndex;
      }
    }

    const required = ['name', 'category', 'brand', 'color', 'size', 'salePrice', 'stock'];
    const missing = required.filter((field) => indexByField[field] === undefined);
    if (missing.length) {
      throw new BadRequestException(
        'Faltan columnas obligatorias en la hoja Productos',
      );
    }

    return indexByField;
  }

  private cell(row: unknown[], index: number | undefined) {
    if (index === undefined) {
      return '';
    }
    return row[index];
  }

  private productGroupKey(row: ParsedRow) {
    if (row.reference) {
      return `REF:${this.normalizeKey(row.reference)}`;
    }
    return `AUTO:${this.normalizeKey(row.name)}|${row.categoryId}|${row.brandId}`;
  }

  private parseRow(
    excelRow: number,
    raw: unknown[],
    fieldIndex: Record<string, number>,
    catalogs: CatalogMaps,
  ): ParsedRow | { message: string } {
    const reference = this.normalize(this.cell(raw, fieldIndex.reference));
    const name = this.normalize(this.cell(raw, fieldIndex.name));
    const description = this.normalize(this.cell(raw, fieldIndex.description)) || null;
    const categoryName = this.normalize(this.cell(raw, fieldIndex.category));
    const brandName = this.normalize(this.cell(raw, fieldIndex.brand));
    const sportName = this.normalize(this.cell(raw, fieldIndex.sport));
    const modelName = this.normalize(this.cell(raw, fieldIndex.model));
    const colorName = this.normalize(this.cell(raw, fieldIndex.color));
    const sizeName = this.normalize(this.cell(raw, fieldIndex.size));
    const itemNo = this.normalize(this.cell(raw, fieldIndex.itemNo));
    const skuValue = this.normalize(this.cell(raw, fieldIndex.sku));
    const statusValue = this.normalize(this.cell(raw, fieldIndex.status));
    const imageValue = this.normalize(this.cell(raw, fieldIndex.imageUrl));

    if (!name) return { message: 'El nombre es obligatorio' };
    if (!categoryName) return { message: 'La categoría es obligatoria' };
    if (!brandName) return { message: 'La marca es obligatoria' };
    if (!colorName) return { message: 'El color es obligatorio' };
    if (!sizeName) return { message: 'La talla es obligatoria' };

    const category = catalogs.categories.get(this.normalizeKey(categoryName));
    if (!category) {
      return { message: `Categoría "${categoryName}" no existe en catálogos` };
    }

    const brand = catalogs.brands.get(this.normalizeKey(brandName));
    if (!brand) {
      return { message: `Marca "${brandName}" no existe en catálogos` };
    }

    const color = catalogs.colors.get(this.normalizeKey(colorName));
    if (!color) {
      return { message: `Color "${colorName}" no existe en catálogos` };
    }

    const size = catalogs.sizes.get(this.normalizeKey(sizeName));
    if (!size) {
      return { message: `Talla "${sizeName}" no existe en catálogos` };
    }

    let sportId: string | null = null;
    if (sportName) {
      const sport = catalogs.sports.get(this.normalizeKey(sportName));
      if (!sport) {
        return { message: `Deporte "${sportName}" no existe en catálogos` };
      }
      sportId = sport.id;
    }

    let productModelId: string | null = null;
    if (modelName) {
      const model = catalogs.models.get(this.normalizeKey(modelName));
      if (!model) {
        return { message: `Modelo "${modelName}" no existe en catálogos` };
      }
      productModelId = model.id;
    }

    const salePrice = this.parsePrice(this.cell(raw, fieldIndex.salePrice));
    if (salePrice === null) {
      return { message: 'El precio de venta es obligatorio y debe ser un número' };
    }

    const stock = this.parseStock(this.cell(raw, fieldIndex.stock));
    if (stock === null) {
      return { message: 'El inventario es obligatorio y debe ser un entero mayor o igual a 0' };
    }

    const status = this.parseStatus(statusValue);
    if (!status) {
      return { message: 'Estatus debe ser ACTIVO o INACTIVO' };
    }

    const imageUrl = this.parseImageUrl(imageValue);
    if (imageValue && !imageUrl) {
      return { message: 'Imagen debe ser una URL http(s) válida' };
    }

    return {
      excelRow,
      reference,
      name,
      description,
      categoryId: category.id,
      brandId: brand.id,
      sportId,
      productModelId,
      colorId: color.id,
      sizeId: size.id,
      itemNo,
      sku: skuValue,
      salePrice,
      stock,
      status,
      imageUrl,
    };
  }

  private collectFileDuplicates(rows: ParsedRow[], errors: ImportError[]) {
    const byItemNo = new Map<string, number>();
    const byCombo = new Map<string, number>();

    for (const row of rows) {
      if (row.itemNo) {
        const itemKey = this.normalizeKey(row.itemNo);
        const previousItem = byItemNo.get(itemKey);
        if (previousItem) {
          errors.push({
            row: previousItem,
            message: `El No "${row.itemNo}" está duplicado (también en la fila ${row.excelRow})`,
          });
          errors.push({
            row: row.excelRow,
            message: `El No "${row.itemNo}" está duplicado (también en la fila ${previousItem})`,
          });
        } else {
          byItemNo.set(itemKey, row.excelRow);
        }
      }

      const comboKey = `${this.productGroupKey(row)}|${row.colorId}|${row.sizeId}`;
      const previousCombo = byCombo.get(comboKey);
      if (previousCombo) {
        errors.push({
          row: previousCombo,
          message: `La combinación referencia + color + talla está duplicada (también en la fila ${row.excelRow})`,
        });
        errors.push({
          row: row.excelRow,
          message: `La combinación referencia + color + talla está duplicada (también en la fila ${previousCombo})`,
        });
      } else {
        byCombo.set(comboKey, row.excelRow);
      }
    }
  }

  private collectGroupConflicts(
    groups: Map<string, ParsedRow[]>,
    errors: ImportError[],
  ) {
    for (const group of groups.values()) {
      const first = group[0];
      const hasConflict = group.some(
        (row) =>
          row.name !== first.name ||
          row.categoryId !== first.categoryId ||
          row.brandId !== first.brandId,
      );

      if (!hasConflict) {
        continue;
      }

      for (const row of group) {
        errors.push({
          row: row.excelRow,
          message: `Nombre, categoría o marca no coinciden entre las filas del mismo producto`,
        });
      }
    }
  }

  private async upsertProductGroup(
    companyId: string,
    userId: string,
    group: ParsedRow[],
  ) {
    const first = group[0];

    try {
      return await this.prisma.$transaction(async (tx) => {
      let product = first.reference
        ? await tx.product.findFirst({
            where: { companyId, reference: first.reference },
          })
        : await tx.product.findFirst({
            where: {
              companyId,
              name: first.name,
              categoryId: first.categoryId,
              brandId: first.brandId,
            },
          });

      const coverUrl =
        group.find((row) => row.imageUrl)?.imageUrl ?? null;
      let createdProduct = false;

      if (!product) {
        createdProduct = true;
        const reference =
          first.reference ||
          (await allocateProductReferences(tx, companyId, 1))[0];
        product = await tx.product.create({
          data: {
            companyId,
            reference,
            name: first.name,
            description: first.description,
            categoryId: first.categoryId,
            brandId: first.brandId,
            sportId: first.sportId,
            productModelId: first.productModelId,
            imageUrl: coverUrl,
          },
        });
      } else {
        await tx.product.update({
          where: { id: product.id },
          data: {
            name: first.name,
            description: first.description,
            categoryId: first.categoryId,
            brandId: first.brandId,
            sportId: first.sportId,
            productModelId: first.productModelId,
            ...(coverUrl ? { imageUrl: coverUrl } : {}),
          },
        });
      }

      let createdVariants = 0;
      let updatedVariants = 0;

      for (const row of group) {
        const action = await this.upsertVariant(tx, {
          companyId,
          userId,
          productId: product.id,
          row,
        });
        if (action === 'created') createdVariants += 1;
        else updatedVariants += 1;
      }

      return { createdProduct, createdVariants, updatedVariants };
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException(
          'Ya existe un producto o variante con esos datos únicos',
        );
      }
      throw error;
    }
  }

  private async upsertVariant(
    tx: Prisma.TransactionClient,
    params: {
      companyId: string;
      userId: string;
      productId: string;
      row: ParsedRow;
    },
  ) {
    const { companyId, userId, productId, row } = params;

    const byItemNo = row.itemNo
      ? await tx.productVariant.findFirst({
          where: { companyId, itemNo: row.itemNo },
        })
      : null;

    if (byItemNo && byItemNo.productId !== productId) {
      throw new BadRequestException(
        `El No "${row.itemNo}" ya pertenece a otro producto`,
      );
    }

    const byCombo = await tx.productVariant.findFirst({
      where: {
        companyId,
        productId,
        colorId: row.colorId,
        sizeId: row.sizeId,
      },
    });

    if (byItemNo && byCombo && byItemNo.id !== byCombo.id) {
      throw new BadRequestException(
        `El No "${row.itemNo}" y la combinación color/talla apuntan a variantes distintas`,
      );
    }

    const existing = byCombo || byItemNo;
    const itemNo =
      row.itemNo ||
      existing?.itemNo ||
      (await allocateItemNumbers(tx, companyId, 1))[0];
    const sku = row.sku || itemNo;

    if (existing) {
      await tx.productVariant.update({
        where: { id: existing.id },
        data: {
          itemNo,
          sku,
          salePrice: row.salePrice,
          status: row.status,
          imageUrl: row.imageUrl ?? existing.imageUrl,
        },
      });
      await this.reconcileStock(tx, companyId, userId, existing.id, row.stock);
      return 'updated' as const;
    }

    const variant = await tx.productVariant.create({
      data: {
        companyId,
        productId,
        colorId: row.colorId,
        sizeId: row.sizeId,
        itemNo,
        sku,
        salePrice: row.salePrice,
        stock: 0,
        status: row.status,
        imageUrl: row.imageUrl,
      },
    });

    if (row.stock > 0) {
      await tx.stockMovement.create({
        data: {
          companyId,
          variantId: variant.id,
          type: StockMovementType.IN,
          reason: StockMovementReason.INITIAL,
          quantity: row.stock,
          stockBefore: 0,
          stockAfter: row.stock,
          note: 'Stock inicial importado desde Excel',
          reference: 'excel-import',
          createdById: userId,
        },
      });
      await tx.productVariant.update({
        where: { id: variant.id },
        data: { stock: row.stock },
      });
    }

    return 'created' as const;
  }

  private async reconcileStock(
    tx: Prisma.TransactionClient,
    companyId: string,
    userId: string,
    variantId: string,
    targetStock: number,
  ) {
    const variant = await tx.productVariant.findFirst({
      where: { id: variantId, companyId },
    });

    if (!variant) {
      return;
    }

    const delta = targetStock - variant.stock;
    if (delta === 0) {
      return;
    }

    await tx.stockMovement.create({
      data: {
        companyId,
        variantId,
        type: delta > 0 ? StockMovementType.IN : StockMovementType.OUT,
        reason:
          delta > 0
            ? StockMovementReason.POSITIVE_ADJUSTMENT
            : StockMovementReason.NEGATIVE_ADJUSTMENT,
        quantity: Math.abs(delta),
        stockBefore: variant.stock,
        stockAfter: targetStock,
        note: 'Ajuste de inventario importado desde Excel',
        reference: 'excel-import',
        createdById: userId,
      },
    });

    await tx.productVariant.update({
      where: { id: variantId },
      data: { stock: targetStock },
    });
  }

  private parsePrice(value: unknown): number | null {
    if (value === '' || value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return Number(value.toFixed(2));
    }

    const cleaned = this.normalize(value).replace(/[^0-9.,-]/g, '').replace(/,/g, '');
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return Number(parsed.toFixed(2));
  }

  private parseStock(value: unknown): number | null {
    if (value === '' || value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return Math.max(0, Math.trunc(value));
    }

    const parsed = Number(this.normalize(value).replace(/,/g, ''));
    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }
    return Math.trunc(parsed);
  }

  private parseStatus(value: string): ProductStatus | null {
    if (!value) {
      return ProductStatus.ACTIVE;
    }

    const key = this.normalizeKey(value);
    if (key === 'ACTIVO' || key === 'ACTIVE') {
      return ProductStatus.ACTIVE;
    }
    if (key === 'INACTIVO' || key === 'INACTIVE') {
      return ProductStatus.INACTIVE;
    }
    return null;
  }

  private parseImageUrl(value: string): string | null {
    if (!value) {
      return null;
    }
    if (/^https?:\/\//i.test(value)) {
      return value;
    }
    return null;
  }

  private isEmptyRow(row: unknown[]) {
    return row.every((cell) => this.normalize(cell) === '');
  }

  private normalize(value: unknown) {
    return String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeKey(value: unknown) {
    return this.normalize(value).toUpperCase();
  }
}
