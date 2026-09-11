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
import { Workbook, type DataValidation, type Worksheet } from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { allocateItemNumbers, allocateProductReferences } from './product-codes';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const TEMPLATE_DATA_ROWS = 500;

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
] as const;

type CatalogMaps = {
  categories: Map<string, { id: string; name: string }>;
  brands: Map<string, { id: string; name: string }>;
  colors: Map<string, { id: string; name: string }>;
  sizes: Map<string, { id: string; name: string }>;
  sports: Map<string, { id: string; name: string }>;
  models: Map<string, { id: string; name: string }>;
};

const CATALOG_DROPDOWNS: Array<{
  column: string;
  sheet: string;
  key: keyof CatalogMaps;
}> = [
  { column: 'D', sheet: 'Categorias', key: 'categories' },
  { column: 'E', sheet: 'Marcas', key: 'brands' },
  { column: 'F', sheet: 'Deportes', key: 'sports' },
  { column: 'G', sheet: 'Modelos', key: 'models' },
  { column: 'H', sheet: 'Colores', key: 'colors' },
  { column: 'I', sheet: 'Tallas', key: 'sizes' },
];

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
    const [catalogs, existingRows] = await Promise.all([
      this.loadCatalogs(companyId),
      this.loadExistingProductRows(companyId),
    ]);
    const workbook = new Workbook();
    const dataRows = Math.max(TEMPLATE_DATA_ROWS, existingRows.length + 200);

    const instructions = workbook.addWorksheet('Instrucciones');
    const instructionLines = [
      'Carga masiva de productos — Spot Deportivo Pro',
      '',
      '1. La hoja Productos sale con el inventario actual: un producto por cada variante (color + talla).',
      '2. Puedes editar filas, agregar nuevas o dejar Referencia/No vacíos en altas para que se generen solos.',
      '3. Categoría, Marca, Color, Talla, Deporte y Modelo se eligen con la lista desplegable de cada celda.',
      '4. Varias filas con la misma Referencia forman un solo producto.',
      '5. Deporte y Modelo son opcionales. Categoría, Marca, Color y Talla son obligatorios.',
      '6. No se crean catálogos nuevos desde este Excel: agrégalos primero en Inventario > Catálogos y vuelve a descargar la plantilla.',
      '7. Estatus acepta ACTIVO o INACTIVO. Si lo dejas vacío, queda ACTIVO.',
      '8. Las fotos se suben en el detalle del producto, no en el Excel.',
    ];
    instructionLines.forEach((line, index) => {
      instructions.getCell(index + 1, 1).value = line;
    });
    instructions.getColumn(1).width = 120;

    const products = workbook.addWorksheet('Productos');
    PRODUCT_COLUMNS.forEach((header, index) => {
      const cell = products.getCell(1, index + 1);
      cell.value = header;
      cell.font = { bold: true };
    });
    products.getRow(1).height = 20;
    [18, 28, 32, 18, 18, 16, 18, 16, 12, 14, 14, 14, 14, 12].forEach(
      (width, index) => {
        products.getColumn(index + 1).width = width;
      },
    );

    existingRows.forEach((row, index) => {
      const excelRow = index + 2;
      products.getCell(excelRow, 1).value = row.reference;
      products.getCell(excelRow, 2).value = row.name;
      products.getCell(excelRow, 3).value = row.description;
      products.getCell(excelRow, 4).value = row.category;
      products.getCell(excelRow, 5).value = row.brand;
      products.getCell(excelRow, 6).value = row.sport;
      products.getCell(excelRow, 7).value = row.model;
      products.getCell(excelRow, 8).value = row.color;
      products.getCell(excelRow, 9).value = row.size;
      products.getCell(excelRow, 10).value = row.itemNo;
      products.getCell(excelRow, 11).value = row.sku;
      products.getCell(excelRow, 12).value = row.salePrice;
      products.getCell(excelRow, 13).value = row.stock;
      products.getCell(excelRow, 14).value = row.status;
    });

    for (const dropdown of CATALOG_DROPDOWNS) {
      const names = Array.from(catalogs[dropdown.key].values()).map(
        (item) => item.name,
      );
      this.writeCatalogSheet(workbook, dropdown.sheet, names);
      this.applyListValidation(
        products,
        dropdown.column,
        `${dropdown.sheet}!$A$2:$A$${Math.max(2, names.length + 1)}`,
        names.length === 0,
        dataRows,
      );
    }

    this.applyListValidation(products, 'N', '"ACTIVO,INACTIVO"', false, dataRows);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
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

      if (this.isProductOnlyPlaceholder(raw, fieldIndex)) {
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

  private writeCatalogSheet(
    workbook: Workbook,
    name: string,
    values: string[],
  ) {
    const sheet = workbook.addWorksheet(name);
    sheet.getCell(1, 1).value = 'Nombre';
    sheet.getCell(1, 1).font = { bold: true };
    values.forEach((value, index) => {
      sheet.getCell(index + 2, 1).value = value;
    });
    sheet.getColumn(1).width = 32;
    sheet.state = 'hidden';
  }

  private applyListValidation(
    sheet: Worksheet,
    column: string,
    formula: string,
    emptyList: boolean,
    dataRows = TEMPLATE_DATA_ROWS,
  ) {
    if (emptyList) {
      return;
    }

    const lastRow = dataRows + 1;
    const validation: DataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [formula],
      showErrorMessage: true,
      errorStyle: 'error',
      errorTitle: 'Valor inválido',
      error: 'Selecciona un valor de la lista desplegable.',
    };

    for (let row = 2; row <= lastRow; row += 1) {
      sheet.getCell(`${column}${row}`).dataValidation = validation;
    }
  }

  private async loadExistingProductRows(companyId: string) {
    const products = await this.prisma.product.findMany({
      where: { companyId },
      include: {
        category: { select: { name: true } },
        brand: { select: { name: true } },
        sport: { select: { name: true } },
        productModel: { select: { name: true } },
        variants: {
          include: {
            color: { select: { name: true } },
            size: { select: { name: true, sortOrder: true } },
          },
          orderBy: [{ createdAt: 'asc' }],
        },
      },
      orderBy: [{ name: 'asc' }, { reference: 'asc' }],
    });

    const rows: Array<{
      reference: string;
      name: string;
      description: string;
      category: string;
      brand: string;
      sport: string;
      model: string;
      color: string;
      size: string;
      itemNo: string;
      sku: string;
      salePrice: number | '';
      stock: number | '';
      status: string;
    }> = [];

    for (const product of products) {
      const variants = [...product.variants].sort((left, right) => {
        const sizeOrder = left.size.sortOrder - right.size.sortOrder;
        if (sizeOrder !== 0) {
          return sizeOrder;
        }
        return left.color.name.localeCompare(right.color.name, 'es');
      });

      if (!variants.length) {
        rows.push({
          reference: product.reference,
          name: product.name,
          description: product.description || '',
          category: product.category.name,
          brand: product.brand.name,
          sport: product.sport?.name || '',
          model: product.productModel?.name || '',
          color: '',
          size: '',
          itemNo: '',
          sku: '',
          salePrice: '',
          stock: '',
          status: '',
        });
        continue;
      }

      for (const variant of variants) {
        rows.push({
          reference: product.reference,
          name: product.name,
          description: product.description || '',
          category: product.category.name,
          brand: product.brand.name,
          sport: product.sport?.name || '',
          model: product.productModel?.name || '',
          color: variant.color.name,
          size: variant.size.name,
          itemNo: variant.itemNo || '',
          sku: variant.sku || '',
          salePrice: Number(variant.salePrice),
          stock: variant.stock,
          status: variant.status === ProductStatus.ACTIVE ? 'ACTIVO' : 'INACTIVO',
        });
      }
    }

    return rows;
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

  private isProductOnlyPlaceholder(
    row: unknown[],
    fieldIndex: Record<string, number>,
  ) {
    const hasVariantData = [
      fieldIndex.color,
      fieldIndex.size,
      fieldIndex.itemNo,
      fieldIndex.sku,
      fieldIndex.salePrice,
      fieldIndex.stock,
    ].some((index) => this.normalize(this.cell(row, index)) !== '');

    return !hasVariantData;
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
