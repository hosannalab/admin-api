# Almacenamiento Cloudflare R2

El bucket puede permanecer **privado**. La API sube con el token S3 y sirve las imágenes en:

`GET /public/media/{companyId}/{products|variants}/{id}/{file}.webp`

Admin y web usan esa URL. El navegador **no** habla con R2.

## Variables en `api-nest/.env`

```env
S3_ENDPOINT="https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
S3_ACCESS_KEY="<access-key-id>"
S3_SECRET_KEY="<secret-access-key>"
S3_BUCKET="spot-deportivo"
S3_REGION="auto"
S3_FORCE_PATH_STYLE="true"
API_PUBLIC_URL="https://api.spotdeportivo.hosannalab.com"
```

`API_PUBLIC_URL` es el origen de la API, no el endpoint de R2. En producción debe ser la URL pública del API.

No hace falta acceso público en R2 ni CORS de R2 para ver el catálogo.

## Endpoints

| Método | Ruta | Auth |
|--------|------|------|
| POST | `/storage/products/:productId/image` | JWT + `product.update` |
| POST | `/storage/variants/:variantId/image` | JWT + `product.update` |
| GET | `/public/media/*` | ninguna (solo objetos de productos/variantes) |
