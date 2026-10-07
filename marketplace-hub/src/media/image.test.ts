import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  analyzeImage,
  MEDIA_PRESETS,
  transformImage,
} from "./image.js";

test("analyzes image dimensions and flags low resolution", async () => {
  const source = await sharp({
    create: {
      width: 240,
      height: 240,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const result = await analyzeImage(source);

  assert.equal(result.width, 240);
  assert.equal(result.height, 240);
  assert.ok(result.warnings.includes("low_resolution"));
  assert.ok(result.warnings.includes("very_low_resolution"));
});

test("creates storefront variant without enlarging original", async () => {
  const source = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .jpeg()
    .toBuffer();

  const result = await transformImage(source, MEDIA_PRESETS.storefront);

  assert.equal(result.output.format, "webp");
  assert.equal(result.output.width, 800);
  assert.equal(result.output.height, 600);
  assert.ok(result.output.bytes > 0);
  assert.ok(result.output.base64.length > 0);
});

test("creates marketplace JPEG with bounded dimensions", async () => {
  const source = await sharp({
    create: {
      width: 2400,
      height: 1600,
      channels: 4,
      background: { r: 250, g: 250, b: 250, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();

  const result = await transformImage(source, MEDIA_PRESETS.marketplace);

  assert.equal(result.output.format, "jpeg");
  assert.ok(result.output.width <= 1600);
  assert.ok(result.output.height <= 1600);
});
