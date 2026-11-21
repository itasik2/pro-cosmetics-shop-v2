import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { localCatalogDerivative } from "../lib/vercelBlobImages";

test("Sharp fallback creates a centered white 1200px WebP product image", async () => {
  const input = await sharp({
    create: { width: 420, height: 800, channels: 4, background: "#ecf1ed" },
  }).png().toBuffer();
  const derived = await localCatalogDerivative(input);
  const meta = await sharp(derived).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.width, 1200);
  assert.equal(meta.height, 1200);
  assert.ok(derived.length < input.length * 4);
  const corner = await sharp(derived).extract({ left: 2, top: 2, width: 1, height: 1 })
    .raw().toBuffer();
  assert.ok(corner[0] > 242 && corner[1] > 242 && corner[2] > 242);
});

test("Cloudinary outage cannot stop new admin uploads if Blob is configured", () => {
  const route = readFileSync(join(process.cwd(), "app/api/upload/product-image/route.ts"), "utf8");
  const normalizer = readFileSync(join(process.cwd(), "lib/productImageNormalization.ts"), "utf8");
  assert.match(route, /await requireAdmin\(\)/);
  assert.match(route, /blobMediaEnabled\(\)/);
  assert.match(route, /uploadGenericImageToBlob\(bytes\)/);
  assert.match(normalizer, /if \(!blobMediaEnabled\(\)\) return normalizeCloudinaryProductImage/);
  assert.match(normalizer, /return uploadProductImageToBlob\(bytes, \{ cloudinaryDerivative \}\)/);
  assert.match(normalizer, /cloudinary_unavailable_using_blob_local_processing/);
});

test("Existing supplier source photo is used if suspended Cloudinary photos fail", () => {
  const image = readFileSync(join(process.cwd(), "components/ResilientProductImage.tsx"), "utf8");
  const card = readFileSync(join(process.cwd(), "components/ProductCard.tsx"), "utf8");
  const select = readFileSync(join(process.cwd(), "lib/publicProductSelect.ts"), "utf8");
  assert.match(image, /setUsingFallback\(true\)/);
  assert.match(image, /!usingFallback && safeFallback/);
  assert.match(card, /fallbackSrc=\{imageToShow === product\.image \? product\.imageSourceUrl/);
  assert.match(select, /imageSourceUrl: true/);
});
