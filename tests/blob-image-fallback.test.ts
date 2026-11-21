import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { localCatalogDerivative } from "../lib/vercelBlobImages";
import { productCutout } from "../lib/productBackgroundRemoval";

test("local model clears a coloured backdrop while preserving the product", async () => {
  const drawing = Buffer.from(`
    <svg width="320" height="320" xmlns="http://www.w3.org/2000/svg">
      <rect width="320" height="320" fill="#42759e"/>
      <path d="M50 0h30l-35 320H15zm230 0h27l-36 320h-27z" fill="#7195b0"/>
      <rect x="136" y="49" width="48" height="54" rx="6" fill="#28383f"/>
      <rect x="108" y="93" width="104" height="172" rx="18" fill="#f8edcf"/>
      <rect x="119" y="143" width="82" height="67" rx="4" fill="#b35840"/>
      <path d="M134 170h52m-52 13h52" stroke="#fffaf0" stroke-width="4"/>
    </svg>`);
  const input = await sharp(drawing).removeAlpha().png().toBuffer();
  const cutout = await productCutout(input);
  const { data, info } = await sharp(cutout).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
  assert.ok(alpha(30, 180) < 10);
  assert.ok(alpha(160, 300) < 10);
  assert.ok(alpha(160, 70) > 240);
  assert.ok(alpha(160, 150) > 240);
});

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
  assert.match(normalizer, /return uploadProductImageToBlob\(bytes, \{ removeBackground: productImageNormalizationEnabled\(\) \}\)/);
});

test("Existing supplier source photo is used if suspended Cloudinary photos fail", () => {
  const image = readFileSync(join(process.cwd(), "components/ResilientProductImage.tsx"), "utf8");
  const card = readFileSync(join(process.cwd(), "components/ProductCard.tsx"), "utf8");
  const home = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8");
  const batch = readFileSync(join(process.cwd(), "lib/catalogBatch.ts"), "utf8");
  const select = readFileSync(join(process.cwd(), "lib/publicProductSelect.ts"), "utf8");
  assert.match(image, /product\.images\?\.find\(\(image\) => image\.url === src\)/);
  assert.match(image, /\[exactSource, commonImage, commonSource\]/);
  assert.match(image, /setFallbackIndex\(fallbackIndex \+ 1\)/);
  assert.match(card, /src=\{imageToShow\}\s+product=\{product\}/);
  assert.equal((home.match(/image, imageSourceUrl, images, shortDescription/g) || []).length, 2);
  assert.match(batch, /imageSourceUrl: product\.imageSourceUrl, images: product\.images/);
  assert.match(select, /imageSourceUrl: true/);
});
