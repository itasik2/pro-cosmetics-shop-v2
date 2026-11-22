import assert from "node:assert/strict";
import test from "node:test";
import { paginateImageNormalizationProducts } from "../lib/imageNormalizationPagination";
import { catalogPhotoSources, isNormalizedProductImage } from "../lib/catalogImageNormalization";

test("legacy photos enter the queue and each variant uses its own verified source", () => {
  const previous = process.env.BLOB_READ_WRITE_TOKEN;
  process.env.BLOB_READ_WRITE_TOKEN = "test-blob";
  try {
    const legacy = "https://res.cloudinary.com/store/image/upload/e_background_removal/main.webp";
    const variant = "https://res.cloudinary.com/store/image/upload/e_background_removal/variant.webp";
    const mainSource = "https://supplier.example/main.jpg";
    const variantSource = "https://supplier.example/variant.jpg";
    const product = {
      image: legacy, imageSourceUrl: mainSource,
      images: [{ url: legacy, sourceUrl: legacy }, { url: variant, sourceUrl: variantSource }],
    };
    assert.equal(isNormalizedProductImage(legacy), false);
    assert.equal(isNormalizedProductImage("https://store.public.blob.vercel-storage.com/pro-cosmetics/products/background-removed/a.webp"), true);
    assert.deepEqual(catalogPhotoSources(legacy, product), [mainSource]);
    assert.deepEqual(catalogPhotoSources(variant, product), [variantSource]);
    assert.deepEqual(catalogPhotoSources(variant, { ...product, images: [] }), []);
  } finally {
    if (previous === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
    else process.env.BLOB_READ_WRITE_TOKEN = previous;
  }
});

test("normalization reaches products beyond the first 200", async () => {
  const records = Array.from({ length: 350 }, (_, i) => ({
    id: `item-${String(i).padStart(3, "0")}`,
    processed: i !== 311 && i !== 312,
  }));
  const pageSize = 200;
  const visited: string[] = [];
  const pages: number[] = [];

  for await (const page of paginateImageNormalizationProducts(
    async (cursor) => {
      const first = cursor ? records.findIndex((row) => row.id === cursor) + 1 : 0;
      return records.slice(first, first + pageSize);
    },
    pageSize,
  )) {
    pages.push(page.length);
    visited.push(...page.filter((p) => !p.processed).map((p) => p.id));
  }

  assert.deepEqual(pages, [200, 150]);
  assert.deepEqual(visited, ["item-311", "item-312"]);
});

test("pagination returns empty catalog without looping", async () => {
  let calls = 0;
  for await (const page of paginateImageNormalizationProducts(async () => {
    calls += 1;
    return [];
  }, 200)) {
    assert.fail(`unexpected page: ${JSON.stringify(page)}`);
  }
  assert.equal(calls, 1);
});

test("pagination rejects invalid page sizes and repeated cursors", async () => {
  await assert.rejects(async () => {
    for await (const page of paginateImageNormalizationProducts(async () => [], 0)) {
      void page;
    }
  }, /invalid_image_pagination_page_size/);

  await assert.rejects(async () => {
    for await (const page of paginateImageNormalizationProducts(
      async () => [{ id: "stuck" }],
      1,
    )) {
      void page;
    }
  }, /invalid_image_pagination_cursor/);
});
