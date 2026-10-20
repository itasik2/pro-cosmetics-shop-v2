import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import ProductAssistant from "../app/admin/(private)/products/ProductAssistant";
import { VariantPhotoPicker } from "../components/VariantPhotoPicker";
import { extractImagesForNamedProduct } from "../lib/enrichment/extractProduct";
import {
  matchesNamedPhotoProduct,
  namePhotoKey,
} from "../lib/enrichment/photoIdentity";
import { searchVariantPhotos } from "../lib/enrichment/variantPhotoSearch";
import { collectProposalPhotos } from "../lib/enrichment/prepareProposalPhotos";
import { automaticPhotoPlan } from "../lib/enrichment/automaticPhotos";

const product = {
  id: "cream",
  name: "Demela Molecular Cream",
  brandId: "jeuderm",
  brand: { name: "JeuDerm" },
  supplier: { id: "supplier", name: "JeuDerm" },
  supplierSku: "JD-01ABCDE",
  barcode: null,
  volumeValue: 50,
  volumeUnit: "ml",
  image: "",
  variants: [],
  category: "Кремы",
  price: 12000,
  stock: 3,
  isPublished: false,
  isNew: false,
  isPopular: false,
};
const variant = { id: "small", sku: product.supplierSku, label: "50 ml" };
const pageUrl = "https://brand.example/demela-cream-50";
const photoUrl = "https://brand.example/cream-50.jpg";
function productNode(overrides: Record<string, unknown> = {}) {
  return {
    "@type": "Product",
    name: "JeuDerm Demela Molecular Cream 50 ml",
    brand: { "@type": "Brand", name: "JEUDERM" },
    sku: "DM-50",
    description: "Крем для ухода за кожей.",
    image: "/cream-50.jpg",
    ...overrides,
  };
}
function page(nodes: unknown, extra = "") {
  return Buffer.from(
    `<script type="application/ld+json">${JSON.stringify(nodes)}</script>${extra}`,
  );
}
function fetched(buffer: Buffer, finalUrl = pageUrl) {
  return {
    buffer,
    finalUrl,
    contentType: "text/html",
    status: 200,
    headers: {},
  };
}

test("internal price codes use name, brand and exact volume; a sibling size or brand is rejected", () => {
  const source = {
    title: "JEU’DERM Demela Molecular Cream 50 мл",
    brand: "JeuDerm",
    description: "Крем",
  };
  assert.equal(matchesNamedPhotoProduct(product, source), true);
  for (const patch of [
    { title: "JeuDerm Demela Molecular Cream 150 ml" },
    { title: "JeuDerm Demela Molecular Oil 50 ml" },
    { brand: "AnotherBrand" },
    { title: "Demela Molecular Cream" },
    { title: "Demela Molecular Cream 50/150 ml" },
  ])
    assert.equal(
      matchesNamedPhotoProduct(product, { ...source, ...patch }),
      false,
    );
  assert.equal(
    matchesNamedPhotoProduct(product, {
      title: "Demela Molecular Cream",
      brand: "JeuDerm",
      description: "Фасовки 50/150 мл",
    }),
    false,
  );
});

test("name lookup extracts only the matching product node and excludes shared recommendation galleries", () => {
  const buffer = page(
    [
      productNode({
        name: "JeuDerm Demela Molecular Cream 150 ml",
        image: "/cream-150.jpg",
      }),
      productNode(),
      productNode({
        name: "JeuDerm Demela Molecular Oil 50 ml",
        image: "/oil.jpg",
      }),
    ],
    '<meta property="og:image" content="/shared-150.jpg"><div class="product-gallery"><img src="/shared-gallery.jpg"></div>',
  );
  assert.deepEqual(
    extractImagesForNamedProduct({ buffer, finalUrl: pageUrl, product }),
    [photoUrl],
  );
});

test("shared multi-size product offers cannot become a size-specific photo", () => {
  for (const overrides of [
    { hasVariant: [{ "@type": "Product", name: "Other product" }] },
    { offers: [{ sku: "DM50" }, { sku: "DM150" }] },
    { offers: [{ price: 10 }, { price: 20 }] },
    { offers: { "@type": "AggregateOffer", offerCount: 2 } },
  ])
    assert.deepEqual(
      extractImagesForNamedProduct({
        buffer: page(productNode(overrides)),
        finalUrl: pageUrl,
        product,
      }),
      [],
    );
});

test("unstructured pages need confirmed brand, name and volume before their gallery is used", () => {
  const buffer = Buffer.from(
    '<meta property="og:title" content="JeuDerm Demela Molecular Cream 50 ml"><meta property="og:image" content="/cream-50.jpg"><h1>JeuDerm Demela Molecular Cream 50 ml</h1>',
  );
  assert.deepEqual(
    extractImagesForNamedProduct({ buffer, finalUrl: pageUrl, product }),
    [photoUrl],
  );
  assert.deepEqual(
    extractImagesForNamedProduct({
      buffer,
      finalUrl: pageUrl,
      product: { ...product, volumeValue: 150 },
    }),
    [],
  );
});

test("synthetic-SKU photo lookup skips the internal code, rejects a sibling and searches by name", async () => {
  let externalCalls = 0;
  const result = await searchVariantPhotos(
    {
      product,
      variant,
      knownUrl: "https://brand.example/cream-150",
      officialDomains: [],
      policies: [],
      priceCandidates: [],
    },
    {
      official: async () => {
        throw new Error("no official domain configured");
      },
      external: async (input) => {
        externalCalls++;
        assert.equal(input.product.supplierSku, null);
        assert.equal(input.product.volumeValue, 50);
        assert.match(input.product.name, /Demela Molecular Cream/);
        assert.ok(
          input.excludedUrls?.includes("https://brand.example/cream-150"),
        );
        return { found: true, url: pageUrl };
      },
      fetchHtml: async (url) =>
        fetched(
          page(
            productNode(
              url.endsWith("150")
                ? {
                    name: "JeuDerm Demela Molecular Cream 150 ml",
                    image: "/cream-150.jpg",
                  }
                : {},
            ),
          ),
          url,
        ),
    },
  );
  assert.equal(externalCalls, 1);
  assert.equal(result.status, "FOUND");
  assert.deepEqual(result.candidates, [
    {
      url: photoUrl,
      source: "WEB",
      sourceUrl: pageUrl,
      identityKey: namePhotoKey(product, variant),
    },
  ]);
});

test("a product without a manufacturer SKU can reuse a verified named page without an AI request", async () => {
  const result = await searchVariantPhotos(
    {
      product: { ...product, supplierSku: null },
      variant: { label: "50 ml" },
      knownUrl: pageUrl,
      officialDomains: [],
      policies: [],
      priceCandidates: [],
    },
    {
      official: async () => {
        throw new Error("must not run");
      },
      external: async () => {
        throw new Error("must not run");
      },
      fetchHtml: async () => fetched(page(productNode())),
    },
  );
  assert.equal(result.status, "FOUND");
  assert.equal(result.candidates[0].url, photoUrl);
});

test("automatic named photo discovery works for standalone products and preserves exact price-list fallback", async () => {
  for (const sku of [product.supplierSku, null]) {
    const current = { ...product, supplierSku: sku };
    let searched = 0;
    const photos = await collectProposalPhotos(
      {
        product: current,
        groups: [],
        knownUrl: pageUrl,
        officialDomains: [],
        policies: [],
        deadlineAt: Date.now() + 5000,
      },
      async (input) => {
        searched++;
        assert.equal(input.catalogOnly, false);
        return {
          sku: input.variant.sku || "",
          status: "FOUND",
          issues: [],
          candidates: [
            {
              url: photoUrl,
              source: "WEB",
              identityKey: namePhotoKey(current, input.variant),
            },
          ],
        };
      },
    );
    assert.equal(searched, 1);
    assert.equal(photos.photoAutomation.version, 2);
    assert.equal(automaticPhotoPlan(current, photos).imageUrl, photoUrl);
    assert.deepEqual(photos.variantImageCandidates, []);
  }
  const price = {
    url: "https://price.example/cream.jpg",
    source: "PRICE_LIST" as const,
    rowNumber: 2,
  };
  const fallback = await searchVariantPhotos(
    {
      product,
      variant,
      knownUrl: pageUrl,
      officialDomains: [],
      policies: [],
      priceCandidates: [price],
      catalogOnly: true,
    },
    {
      official: async () => ({ found: false, url: null }),
      external: async () => ({ found: false, url: null }),
      fetchHtml: async () =>
        fetched(page(productNode({ name: "Wrong product" }))),
    },
  );
  assert.deepEqual(fallback.candidates, [price]);
});

test("repeated lookup replaces a stale name-photo fingerprint even when the image URL stays the same", async () => {
  const current = { ...product, volumeValue: 150 };
  const photos = await collectProposalPhotos(
    {
      product: current,
      groups: [],
      productGroups: [
        {
          variantId: "product:cream",
          sku: product.supplierSku,
          candidates: [
            {
              url: photoUrl,
              source: "WEB",
              identityKey: namePhotoKey(product),
            },
          ],
        },
      ],
      knownUrl: pageUrl,
      officialDomains: [],
      policies: [],
      deadlineAt: Date.now() + 5000,
    },
    async (input) => ({
      sku: product.supplierSku,
      status: "FOUND",
      issues: [],
      candidates: [
        {
          url: photoUrl,
          source: "WEB",
          identityKey: namePhotoKey(current, input.variant),
        },
      ],
    }),
  );
  assert.equal(automaticPhotoPlan(current, photos).imageUrl, photoUrl);
  assert.equal(automaticPhotoPlan(product, photos).imageUrl, null);
});

test("admin controls explain name-based discovery for an internal price code", () => {
  const html = renderToStaticMarkup(
    <ProductAssistant
      product={product}
      dirty={false}
      disabled={false}
      onBusyChange={() => {}}
      onSaved={() => {}}
    />,
  );
  assert.match(html, /Найти описание и фото по названию/);
  assert.match(html, /внутренний код прайса/);
  const variantHtml = renderToStaticMarkup(
    <VariantPhotoPicker
      productId={product.id}
      variant={variant}
      commonImage=""
      onChange={() => {}}
    />,
  );
  assert.match(variantHtml, /Найти фото по названию/);
});
