/**
 * Crea el bucket y política de lectura pública para imágenes de productos.
 * Requiere MinIO en marcha: docker compose up -d minio
 *
 * Uso: node scripts/setup-minio.js
 */
const { config: loadEnv } = require('dotenv');
const { resolve } = require('path');
const {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketPolicyCommand,
} = require('@aws-sdk/client-s3');

loadEnv({ path: resolve(process.cwd(), '.env'), override: true });

const endpoint = process.env.S3_ENDPOINT || 'http://127.0.0.1:9000';
const accessKeyId = process.env.S3_ACCESS_KEY || 'minioadmin';
const secretAccessKey = process.env.S3_SECRET_KEY || 'minioadmin';
const bucket = process.env.S3_BUCKET || 'spot-deportivo';

const client = new S3Client({
  endpoint,
  region: process.env.S3_REGION || 'us-east-1',
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle: true,
});

async function ensureBucket() {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    console.log(`Bucket "${bucket}" ya existe.`);
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    console.log(`Bucket "${bucket}" creado.`);
  }
}

async function setPublicReadPolicy() {
  const policy = {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${bucket}/*`],
      },
    ],
  };

  await client.send(
    new PutBucketPolicyCommand({
      Bucket: bucket,
      Policy: JSON.stringify(policy),
    }),
  );
  console.log('Política de lectura pública aplicada al bucket.');
}

async function main() {
  await ensureBucket();
  await setPublicReadPolicy();
  const publicUrl = process.env.S3_PUBLIC_URL || `http://127.0.0.1:9000/${bucket}`;
  console.log(`URL pública base: ${publicUrl}`);
}

main().catch((error) => {
  console.error('Error configurando MinIO:', error.message);
  process.exit(1);
});
