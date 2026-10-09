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


test("creates custom padded portrait profile with exact canvas", async () => {
  const source = await sharp({
    create: {
      width: 900,
      height: 600,
      channels: 3,
      background: { r: 245, g: 245, b: 245 },
    },
  })
    .jpeg()
    .toBuffer();

  const result = await transformImage(source, {
    width: 1200,
    height: 1500,
    mode: "PAD",
    format: "webp",
    quality: 88,
    allowUpscale: false,
    background: "#ffffff",
    trim: false,
    maxWidth: 1200,
    maxHeight: 1500,
  });

  assert.equal(result.output.format, "webp");
  assert.equal(result.output.width, 1200);
  assert.equal(result.output.height, 1500);
});

test("supports arbitrary PNG landscape output", async () => {
  const source = await sharp({
    create: {
      width: 1800,
      height: 1200,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();

  const result = await transformImage(source, {
    width: 1280,
    height: 720,
    mode: "COVER",
    format: "png",
    quality: 90,
    allowUpscale: false,
    background: "#ffffff",
    trim: false,
    maxWidth: 1280,
    maxHeight: 720,
  });

  assert.equal(result.output.format, "png");
  assert.equal(result.output.width, 1280);
  assert.equal(result.output.height, 720);
});
