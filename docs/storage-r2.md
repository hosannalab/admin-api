# Almacenamiento Cloudflare R2

La API ya usa el SDK de S3. R2 es compatible; no hay que cambiar admin-react ni web-react. Lo que sí cambia es la configuración y cómo se publica la URL de cada imagen.

## 1. Credenciales en Cloudflare

1. Crea un bucket (por ejemplo `spot-deportivo`).
2. Crea un **R2 API token** con permiso de lectura/escritura sobre ese bucket.
3. Publica el bucket:
   - dominio custom (`https://media.tudominio.com`), o
   - URL pública `r2.dev` (`https://pub-xxxxx.r2.dev`).

El endpoint `*.r2.cloudflarestorage.com` **no** sirve imágenes al navegador. `S3_PUBLIC_URL` debe ser el dominio público.

## 2. Variables en `api-nest/.env`

```env
S3_ENDPOINT="https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
S3_ACCESS_KEY="<access-key-id>"
S3_SECRET_KEY="<secret-access-key>"
S3_BUCKET="spot-deportivo"
S3_REGION="auto"
S3_PUBLIC_URL="https://media.tudominio.com"
S3_FORCE_PATH_STYLE="true"
```

`S3_PUBLIC_URL` no debe incluir el nombre del bucket si usas dominio custom o `r2.dev`. Las URLs guardadas quedan así:

`https://media.tudominio.com/{companyId}/products/{productId}/{uuid}.webp`

## 3. Qué no hace falta

- No uses `npm run storage:setup-minio` contra R2. La lectura pública se configura en el dashboard de Cloudflare, no con bucket policy de MinIO.
- Admin y web pública no cambian: siguen usando `imageUrl` del API.

## 4. Imágenes antiguas

Las URLs ya guardadas en `Product.imageUrl` / `ProductVariant.imageUrl` apuntan al storage anterior. Hay que volver a subirlas o migrar los objetos a R2 y actualizar las URLs.

## 5. Endpoints de subida (JWT + `product.update`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/storage/products/:productId/image` | Imagen del producto (`file`) |
| POST | `/storage/variants/:variantId/image` | Imagen de variante |

Las imágenes se comprimen a WebP (máx. 1200px, calidad 80) antes de subirse.
