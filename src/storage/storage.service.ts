import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const MAX_IMAGE_WIDTH = 1200;
const WEBP_QUALITY = 80;

@Injectable()
export class StorageService {
  private readonly s3: S3Client | null;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly enabled: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const endpoint = this.config.get<string>('S3_ENDPOINT');
    const accessKeyId = this.config.get<string>('S3_ACCESS_KEY');
    const secretAccessKey = this.config.get<string>('S3_SECRET_KEY');
    this.bucket = this.config.get<string>('S3_BUCKET') ?? 'spot-deportivo';
    this.publicBaseUrl = (
      this.config.get<string>('S3_PUBLIC_URL') ?? 'http://localhost:9000/spot-deportivo'
    ).replace(/\/$/, '');

    this.enabled = Boolean(endpoint && accessKeyId && secretAccessKey);

    this.s3 =
      this.enabled && endpoint && accessKeyId && secretAccessKey
        ? new S3Client({
            endpoint,
            region: this.config.get<string>('S3_REGION') ?? 'us-east-1',
            credentials: {
              accessKeyId,
              secretAccessKey,
            },
            forcePathStyle: true,
          })
        : null;
  }

  assertConfigured() {
    if (!this.enabled || !this.s3) {
      throw new ServiceUnavailableException(
        'Almacenamiento S3/MinIO no configurado. Revisa S3_ENDPOINT, S3_ACCESS_KEY y S3_SECRET_KEY.',
      );
    }
  }

  validateImageFile(file: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No se recibió ningún archivo.');
    }

    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        'Formato no permitido. Usa JPG, PNG, WebP o GIF.',
      );
    }
  }

  async compressImage(buffer: Buffer) {
    try {
      const output = await sharp(buffer)
        .rotate()
        .resize({
          width: MAX_IMAGE_WIDTH,
          height: MAX_IMAGE_WIDTH,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: WEBP_QUALITY })
        .toBuffer();

      return {
        buffer: output,
        contentType: 'image/webp',
        extension: 'webp',
      };
    } catch {
      throw new BadRequestException('No se pudo procesar la imagen.');
    }
  }

  buildObjectKey(
    companyId: string,
    scope: 'products' | 'variants',
    entityId: string,
    extension: string,
  ) {
    return `${companyId}/${scope}/${entityId}/${randomUUID()}.${extension}`;
  }

  buildPublicUrl(key: string) {
    return `${this.publicBaseUrl}/${key}`;
  }

  async uploadBuffer(key: string, buffer: Buffer, contentType: string) {
    this.assertConfigured();

    await this.s3!.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    return this.buildPublicUrl(key);
  }

  async uploadProductImage(
    companyId: string,
    productId: string,
    file: Express.Multer.File,
  ) {
    this.validateImageFile(file);

    const product = await this.prisma.product.findFirst({
      where: { id: productId, companyId },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado.');
    }

    const compressed = await this.compressImage(file.buffer);
    const key = this.buildObjectKey(
      companyId,
      'products',
      productId,
      compressed.extension,
    );
    const url = await this.uploadBuffer(
      key,
      compressed.buffer,
      compressed.contentType,
    );

    await this.prisma.product.update({
      where: { id: productId },
      data: { imageUrl: url },
    });

    return { url, key };
  }

  async uploadVariantImage(
    companyId: string,
    variantId: string,
    file: Express.Multer.File,
  ) {
    this.validateImageFile(file);

    const variant = await this.prisma.productVariant.findFirst({
      where: { id: variantId, companyId },
      select: { id: true },
    });

    if (!variant) {
      throw new NotFoundException('Variante no encontrada.');
    }

    const compressed = await this.compressImage(file.buffer);
    const key = this.buildObjectKey(
      companyId,
      'variants',
      variantId,
      compressed.extension,
    );
    const url = await this.uploadBuffer(
      key,
      compressed.buffer,
      compressed.contentType,
    );

    await this.prisma.productVariant.update({
      where: { id: variantId },
      data: { imageUrl: url },
    });

    return { url, key };
  }
}
