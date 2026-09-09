# Product image normalization

## Goal

Product photos should have one visual standard across the catalog:

- AI background removal;
- transparent empty edges trimmed;
- foreground scaled to fit inside a 960 × 960 content area;
- centered on a 1200 × 1200 square canvas;
- white background by default;
- WebP catalog derivative;
- original asset preserved in Cloudinary.

## New uploads

`POST /api/upload/product-image` keeps the generic upload behavior for blog/settings media. Uploads coming from `/admin/products` are treated as product images automatically. A caller can also explicitly send the multipart field:

```text
purpose=product
```

The product workflow:

1. validates MIME type and magic bytes;
2. uploads the untouched original to Cloudinary;
3. requests the Cloudinary `background_removal` transformation;
4. trims transparent borders;
5. limits the product to the configured content box;
6. pads it to the square catalog canvas;
7. returns the processed URL while retaining `originalUrl` in the response.

If AI background removal fails, the upload itself is not lost. The API returns the original image as `url`, `processingStatus=NEEDS_REVIEW` and a short error reason.

## Existing catalog

Admin page:

```text
/admin/image-normalization
```

It provides:

- current normalized/remaining counts;
- processing in batches of 3;
- full-catalog processing using repeated small batches;
- automatic stop when the same failures remain repeatedly.

API:

```text
GET  /api/admin/products/normalize-images
POST /api/admin/products/normalize-images
```

`POST` accepts:

```json
{ "limit": 3 }
```

The limit is capped at 5 to keep Vercel requests bounded. Before replacing a product image, the source is copied into Cloudinary. The resulting primary derivative is also recorded in `ProductImage`.

## Imported supplier images

Images accepted through catalog enrichment now use the same shared normalization pipeline before becoming the primary product image.

## Configuration

```text
PRODUCT_IMAGE_NORMALIZATION_ENABLED=true
PRODUCT_IMAGE_CANVAS_SIZE=1200
PRODUCT_IMAGE_CONTENT_SIZE=960
PRODUCT_IMAGE_BACKGROUND=white
```

Cloudinary credentials are required:

```text
CLOUDINARY_CLOUD_NAME
CLOUDINARY_API_KEY
CLOUDINARY_API_SECRET
```

## Operational notes

Cloudinary counts AI background removal as a special transformation. Do not repeatedly force regeneration of already normalized assets without a reason.

The original file is deliberately never replaced with the background-removed derivative. This makes rollback and manual review possible if an AI mask damages transparent packaging, fine pump tubes, shadows, or other difficult product edges.
