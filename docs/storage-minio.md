# Almacenamiento MinIO (S3-compatible)

## 1. Levantar MinIO

Desde la raíz del monorepo:

```bash
docker compose up -d minio
```

- API S3: http://127.0.0.1:9000
- Consola web: http://127.0.0.1:9001 (usuario/contraseña: `minioadmin`)

## 2. Configurar bucket y lectura pública

En `api-nest/.env`:

```env
S3_ENDPOINT="http://127.0.0.1:9000"
S3_ACCESS_KEY="minioadmin"
S3_SECRET_KEY="minioadmin"
S3_BUCKET="spot-deportivo"
S3_REGION="us-east-1"
S3_PUBLIC_URL="http://127.0.0.1:9000/spot-deportivo"
```

Luego:

```bash
cd api-nest
npm run storage:setup-minio
```

## 3. Endpoints de subida (JWT + permiso `product.update`)

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/storage/products/:productId/image` | Sube imagen del producto (multipart `file`) |
| POST | `/storage/variants/:variantId/image` | Sube imagen de variante |

Las imágenes se comprimen a **WebP** (máx. 1200px, calidad 80) antes de subirse. La URL pública se guarda en `Product.imageUrl` o `ProductVariant.imageUrl`.

## 4. Uso en admin-react

- **Editar producto**: selector de archivo en el formulario (requiere producto guardado).
- **Variantes**: acción **Imagen** en la tabla del detalle de producto.

## 5. Visualización en web-react

El storefront ya consume `imageUrl` del API público; no requiere cambios adicionales si MinIO es accesible desde el navegador.
