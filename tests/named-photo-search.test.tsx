import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import ProductAssistant from "../app/admin/(private)/products/ProductAssistant";
import { VariantPhotoPicker } from "../components/VariantPhotoPicker";
import { extractImagesForNamedProduct, extractProductFromHtml } from "../lib/enrichment/extractProduct";
import {
  matchesNamedPhotoProduct,
  namePhotoKey,
  samePhotoBrand,
} from "../lib/enrichment/photoIdentity";
import { searchVariantPhotos } from "../lib/enrichment/variantPhotoSearch";
import { collectProposalPhotos } from "../lib/enrichment/prepareProposalPhotos";
import { automaticPhotoPlan } from "../lib/enrichment/automaticPhotos";
import { proposalPhotoSearchMessages } from "../lib/enrichment/clientMessages";
import {
  namedBrandCatalogUrls,
  catalogConfirmsProductBrand,
} from "../lib/enrichment/officialCatalogSearch";

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

const reformUrl =
  "https://tmbeautybrands.com/products/reform-age-dna-cream-110-ml";
const creamCatalogUrl = "https://tmbeautybrands.com/collections/creams-jeuderm";
const reformPage = readFileSync(
  resolve("tests/fixtures/reform-age-retailer.html"),
);
const creamCatalogPage = readFileSync(
  resolve("tests/fixtures/jeuderm-cream-collection.html"),
);
const reformProduct = {
  ...product,
  name: "Reform Age DNA Крем",
  volumeValue: 110,
};

const rugPage = readFileSync(resolve("tests/fixtures/skinosophy-rug.html"));
const rugUrl = "https://skinosophy.kz/catalog/rug";
const rugPhoto = "https://static.tildacdn.pro/tild3639-3732-4430-b161-636632353030/skinosophy13238.jpg";
const rugProduct = {
  ...product,
  id: "skinosophy-rug",
  name: "Плед Skinosophy, серый",
  supplierSku: "INT-PRICE-E85B929230C3",
  brandId: "skinosophy",
  brand: { name: "Skinosophy" },
  volumeValue: null,
  volumeUnit: null,
};

test("the reported Skinosophy rug uses its full-resolution Tilda gallery and scoped color, excluding the site badge and related products", () => {
  const extracted = extractProductFromHtml({ buffer: rugPage, finalUrl: rugUrl });
  assert.equal(extracted.title, "Плед");
  assert.equal(extracted.color, "серый");
  assert.equal(extracted.sku, null);
  assert.deepEqual(extracted.images, [rugPhoto]);
  assert.ok(extracted.description?.includes("косметологических кабинетов"));
  assert.deepEqual(extractImagesForNamedProduct({
    buffer: rugPage, finalUrl: rugUrl, product: rugProduct,
  }), [rugPhoto]);
  assert.deepEqual(extractImagesForNamedProduct({
    buffer: rugPage, finalUrl: rugUrl, product: { ...rugProduct, name: "Плед Skinosophy" },
  }), [rugPhoto]);
  const withRelated = rugPage.toString().replace('<!--/gallery -->', '<!--/gallery --><div class="recommendations"><div class="js-product-img" data-original="https://static.tildacdn.pro/another-product.jpg"></div></div>');
  assert.deepEqual(extractProductFromHtml({
    buffer: Buffer.from(withRelated), finalUrl: rugUrl,
  }).images, [rugPhoto]);
});

test("Tilda name matching rejects another color, accessory, manufacturer or ambiguous product options", () => {
  for (const patch of [
    { name: "Плед Skinosophy, синий" },
    { name: "Полотенце Skinosophy, серое" },
    { brand: { name: "OtherBrand" } },
    { name: "Плед Skinosophy, серый 150x200" },
  ]) assert.deepEqual(extractImagesForNamedProduct({
    buffer: rugPage, finalUrl: rugUrl, product: { ...rugProduct, ...patch },
  }), []);
  const html = rugPage.toString();
  for (const altered of [
    html.replace("Цвет: серый", "Цвет: серый / синий"),
    html.replace("Цвет: серый", "Цвет: серый<br>Цвет: синий"),
    html.replace("Цвет: серый", "Материал: серый"),
    html.replace('field="title">Плед</h1>', 'field="title">Плед синий</h1>'),
    html.replace('data-record-type="585"', 'data-record-type="396"') + '<footer>Цвет: серый</footer>',
    html.replace(/<div class="js-product-controls-wrapper">\s*<\/div>/, '<div class="js-product-controls-wrapper"><select><option>серый</option><option>синий</option></select></div>'),
  ]) assert.deepEqual(extractImagesForNamedProduct({
    buffer: Buffer.from(altered), finalUrl: rugUrl, product: rugProduct,
  }), []);
});

test("supplier image selectors still read a custom Tilda gallery while remaining inside the primary product", () => {
  const custom = rugPage.toString().replace('class="t-slds"', 'class="custom-gallery"')
    .replace('<!--/gallery -->', '<!--/gallery --><div class="recommendations"><img class="custom-photo" src="https://static.tildacdn.pro/wrong.jpg"></div>');
  const input = { buffer: Buffer.from(custom), finalUrl: rugUrl };
  assert.deepEqual(extractProductFromHtml(input).images, []);
  assert.deepEqual(extractProductFromHtml({
    ...input,
    selectors: { images: ".custom-gallery [data-original], .recommendations img, header img" },
  }).images, [rugPhoto]);
  assert.deepEqual(extractProductFromHtml({
    ...input, selectors: { images: "[invalid" },
  }).images, []);
});

test("the saved rug page supplies an automatic photo for an internal price SKU without an AI search", async () => {
  const requested: string[] = [];
  const photos = await collectProposalPhotos({
    product: rugProduct,
    groups: [],
    knownUrl: rugUrl,
    officialDomains: [],
    policies: [{ domain: "skinosophy.kz", allowSubdomains: true }],
    deadlineAt: Date.now() + 5000,
  }, input => searchVariantPhotos(input, {
    official: async () => { throw new Error("AI must not be needed"); },
    external: async () => { throw new Error("AI must not be needed"); },
    fetchHtml: async (url) => { requested.push(url); return fetched(rugPage, url); },
  }));
  assert.deepEqual(requested, [rugUrl]);
  assert.deepEqual(photos.photoAutomation.issues, []);
  assert.equal(automaticPhotoPlan(rugProduct, photos).imageUrl, rugPhoto);
  assert.equal(automaticPhotoPlan({ ...rugProduct, name: "Плед Skinosophy, синий" }, photos).imageUrl, null);
});

test("Russian product types match English names while model, form and size remain exact", () => {
  const source = {
    title: "JeuDerm Reform Age DNA Cream, 110 ml",
    brand: "JeuDerm",
    description: null,
  };
  for (const name of [
    "Reform Age DNA Крем",
    "Крем Reform Age DNA",
    "ReformAge DNA cream",
  ]) {
    assert.equal(
      matchesNamedPhotoProduct({ ...reformProduct, name }, source),
      true,
    );
  }
  for (const title of [
    "JeuDerm Reform Age DNA Cream, 50 ml",
    "JeuDerm Reform Age Intensive Cream, 110 ml",
    "JeuDerm Reform Age DNA Gel, 110 ml",
  ]) {
    assert.equal(
      matchesNamedPhotoProduct(reformProduct, { ...source, title }),
      false,
    );
  }
});

test("retailer brand metadata needs independent product-specific brand evidence", () => {
  const source = {
    title: "Reform Age DNA Cream, 110 ml",
    brand: "T.M. Beauty Brands LTD",
    retailer: "T.M. Beauty Brands LTD",
    description: null,
  };
  assert.equal(matchesNamedPhotoProduct(reformProduct, source), false);
  for (const patch of [
    { title: "JeuDerm Reform Age DNA Cream, 110 ml" },
    { description: "JeuDerm products are also available in our shop." },
  ]) {
    assert.equal(
      matchesNamedPhotoProduct(reformProduct, { ...source, ...patch }),
      false,
    );
  }
  assert.equal(
    matchesNamedPhotoProduct(reformProduct, {
      ...source,
      confirmedBrand: "JeuDerm",
    }),
    true,
  );
  assert.equal(
    matchesNamedPhotoProduct(reformProduct, {
      ...source,
      brand: "Different Manufacturer",
      confirmedBrand: "JeuDerm",
    }),
    false,
  );
  assert.equal(
    matchesNamedPhotoProduct(
      { ...reformProduct, volumeValue: 50 },
      { ...source, confirmedBrand: "JeuDerm" },
    ),
    false,
  );
});

test("brand collections confirm actual product membership, excluding navigation, cart and recommendations", () => {
  assert.deepEqual(
    namedBrandCatalogUrls(reformPage, reformUrl, "JeuDerm", reformProduct.name),
    [creamCatalogUrl, "https://tmbeautybrands.com/collections/jeuderm-1"],
  );
  assert.equal(
    catalogConfirmsProductBrand(
      creamCatalogPage,
      creamCatalogUrl,
      reformUrl,
      "JeuDerm",
    ),
    true,
  );
  assert.equal(
    catalogConfirmsProductBrand(
      creamCatalogPage,
      creamCatalogUrl,
      reformUrl.replace("110", "50"),
      "JeuDerm",
    ),
    false,
  );
  assert.equal(
    catalogConfirmsProductBrand(
      creamCatalogPage,
      creamCatalogUrl,
      reformUrl,
      "AnotherBrand",
    ),
    false,
  );
  assert.equal(
    catalogConfirmsProductBrand(
      creamCatalogPage,
      creamCatalogUrl,
      reformUrl.replace("tmbeautybrands.com", "other.example"),
      "JeuDerm",
    ),
    false,
  );
  for (const place of [
    "header",
    "nav",
    'div class="recommendations"',
    'div class="cart-recommendations"',
  ]) {
    const tag = place.split(" ")[0];
    const buffer = Buffer.from(
      `<title>JeuDerm Creams</title><main><${place}><div class="product-grid-item"><a href="${reformUrl}">Related item</a></div></${tag}></main>`,
    );
    assert.equal(
      catalogConfirmsProductBrand(
        buffer,
        creamCatalogUrl,
        reformUrl,
        "JeuDerm",
      ),
      false,
    );
  }
});

test("the reported Reform Age 110 ml case finds the product's own photo through its brand catalog without AI", async () => {
  const requested: string[] = [];
  const photos = await collectProposalPhotos(
    {
      product: reformProduct,
      groups: [],
      knownUrl: reformUrl,
      officialDomains: [],
      policies: [],
      deadlineAt: Date.now() + 5000,
    },
    async (input) =>
      searchVariantPhotos(input, {
        official: async () => {
          throw new Error("AI must not be needed");
        },
        external: async () => {
          throw new Error("AI must not be needed");
        },
        fetchHtml: async (url) => {
          requested.push(url);
          assert.ok(url === reformUrl || url === creamCatalogUrl);
          return fetched(
            url === reformUrl ? reformPage : creamCatalogPage,
            url,
          );
        },
      }),
  );
  assert.deepEqual(requested, [reformUrl, creamCatalogUrl]);
  const plan = automaticPhotoPlan(reformProduct, photos);
  assert.equal(
    plan.imageUrl,
    "https://tmbeautybrands.com/cdn/shop/files/DNAcream110ml.png?v=1790148018&width=1920",
  );
  assert.equal(
    automaticPhotoPlan({ ...reformProduct, volumeValue: 50 }, photos).imageUrl,
    null,
  );
  assert.deepEqual(photos.photoAutomation.issues, []);
});

test("a seller's global brand menu cannot validate a product absent from that brand catalog", async () => {
  const result = await searchVariantPhotos(
    {
      product: reformProduct,
      variant: { label: "110 ml", sku: reformProduct.supplierSku },
      knownUrl: reformUrl,
      officialDomains: [],
      policies: [],
      priceCandidates: [],
      catalogOnly: true,
    },
    {
      official: async () => {
        throw new Error("must not run");
      },
      external: async () => {
        throw new Error("must not run");
      },
      fetchHtml: async (url) =>
        fetched(
          url === reformUrl
            ? reformPage
            : Buffer.from(
                '<title>JeuDerm</title><main><div class="product-grid-item"><a href="/products/different-cream">Other cream</a></div></main>',
              ),
          url,
        ),
    },
  );
  assert.equal(result.status, "NOT_FOUND");
  assert.deepEqual(result.candidates, []);
});

test("photo-only discovery excludes a rejected size and retries a different external source", async () => {
  let attempts = 0;
  const rightUrl = "https://brand.example/reform-110";
  const wrongUrl = "https://brand.example/reform-50";
  const result = await searchVariantPhotos(
    {
      product: reformProduct,
      variant: { label: "110 ml", sku: reformProduct.supplierSku },
      officialDomains: [],
      policies: [],
      priceCandidates: [],
    },
    {
      official: async () => {
        throw new Error("no official domains");
      },
      external: async (input) => {
        assert.equal(input.purpose, "PHOTO");
        if (attempts++) assert.ok(input.excludedUrls?.includes(wrongUrl));
        return { found: true, url: attempts === 1 ? wrongUrl : rightUrl };
      },
      fetchHtml: async (url) =>
        fetched(
          page(
            productNode({
              name: `JeuDerm Reform Age DNA Cream ${url === wrongUrl ? 50 : 110} ml`,
              image: url === wrongUrl ? "/wrong-50.jpg" : "/correct-110.jpg",
            }),
          ),
          url,
        ),
    },
  );
  assert.equal(attempts, 2);
  assert.equal(
    result.candidates[0].url,
    "https://brand.example/correct-110.jpg",
  );
});

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
    assert.equal(photos.photoAutomation.version, 7);
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

const cleanserUrl =
  "https://7hmedical.com/products/jeu-derm-reform-age-intensive-mild-cleanser-150ml";
const cleanserCatalogUrl = "https://7hmedical.com/collections/koreansk-hudvard";
const cleanserPhoto =
  "https://7hmedical.com/cdn/shop/files/reformage_mild_cleanser.png?v=1720160649";
const cleanserProduct = {
  ...product,
  id: "cleanser",
  name: "Reforme Age Mild Cleanser",
  supplierSku: "JD-0L2MGHY",
  volumeValue: 150,
};

test("Latin accent folding preserves distinct Cyrillic names and brands", () => {
  assert.equal(samePhotoBrand("JeuDérm", "JeuDerm"), true);
  assert.equal(samePhotoBrand("Май", "Маи"), false);
  assert.equal(samePhotoBrand("Маи\u0306", "Май"), true);
  const source = {
    title: "Маи Care Cream 50 ml",
    brand: "JeuDerm",
    description: null,
  };
  assert.equal(
    matchesNamedPhotoProduct({ ...product, name: "Май Care Cream" }, source),
    false,
  );
  assert.equal(
    matchesNamedPhotoProduct(
      { ...product, name: "Маи\u0306 Care Cream" },
      { ...source, title: "Май Care Cream 50 ml" },
    ),
    true,
  );
  assert.equal(
    matchesNamedPhotoProduct(
      { ...product, brand: { name: "Май" } },
      { title: product.name + " 50 ml", brand: "Маи", description: null },
    ),
    false,
  );
  const collection = Buffer.from(
    '<main><h1>Май</h1><div class="product-grid"><a href="/products/cream">Cream</a></div></main>',
  );
  assert.equal(
    catalogConfirmsProductBrand(
      collection,
      "https://brand.example/collections/may",
      "https://brand.example/products/cream",
      "Маи",
    ),
    false,
  );
});

test("a single extra letter in a long name requires matching brand, form, size and two stable words", () => {
  const source = {
    title: "JeuDérm Reform Age Mild Cleanser 150 ml",
    brand: "JeuDérm",
    description: null,
  };
  assert.equal(matchesNamedPhotoProduct(cleanserProduct, source), true);
  assert.equal(
    matchesNamedPhotoProduct(
      { ...cleanserProduct, name: "Reform Age Mild Cleanser" },
      { ...source, title: "JeuDerm Reforme Age Mild Cleanser 150 ml" },
    ),
    true,
  );
  for (const patch of [
    { brand: "Another Brand" },
    { title: "JeuDerm Reform Age Mild Cleanser 250 ml" },
    { title: "JeuDerm Reform Age Mild Cleanser" },
    { title: "JeuDerm Reform Age Mild Serum 150 ml" },
    { title: "JeuDerm Reform Age Mildest Cleanser 150 ml" },
    { title: "JeuDerm Reform Age Deep Cleanser 150 ml" },
    { title: "JeuDerm Reforn Age Mild Cleanser 150 ml" },
    { title: "JeuDerm Reform Age Mild Cleanser 50/150 ml" },
    {
      brand: null,
      title: "Reform Age Mild Cleanser 150 ml",
      description: "JeuDerm",
    },
  ])
    assert.equal(
      matchesNamedPhotoProduct(cleanserProduct, { ...source, ...patch }),
      false,
      JSON.stringify(patch),
    );
  assert.equal(
    matchesNamedPhotoProduct({ ...cleanserProduct, volumeValue: null }, source),
    false,
  );
  for (const [name, title] of [
    ["Reform Age DNA Cream", "JeuDerm Reform Age DNAA Cream 150 ml"],
    ["Reform Age B12 Cream", "JeuDerm Reform Age B13 Cream 150 ml"],
    ["Reforme Age Cleanser", "JeuDerm Reform Age Cleanser 150 ml"],
    ["Reforme Age Age Cleanser", "JeuDerm Reform Age Age Cleanser 150 ml"],
  ])
    assert.equal(
      matchesNamedPhotoProduct(
        { ...cleanserProduct, name },
        { ...source, title },
      ),
      false,
      name,
    );
});

test("saved Mild Cleanser source resolves the price-list typo only after independent brand-catalog confirmation", async () => {
  const productPage = readFileSync(
    resolve("tests/fixtures/mild-cleanser-retailer.html"),
  );
  const catalogPage = readFileSync(
    resolve("tests/fixtures/jeuderm-cleanser-collection.html"),
  );
  const requested: string[] = [];
  const photos = await collectProposalPhotos(
    {
      product: cleanserProduct,
      groups: [],
      knownUrl: cleanserUrl,
      officialDomains: [],
      policies: [{ domain: "7hmedical.com", allowSubdomains: false }],
      deadlineAt: Date.now() + 5000,
    },
    (input) =>
      searchVariantPhotos(input, {
        official: async () => {
          throw new Error("saved source should resolve without AI");
        },
        external: async () => {
          throw new Error("saved source should resolve without AI");
        },
        fetchHtml: async (url) => {
          requested.push(url);
          assert.ok([cleanserUrl, cleanserCatalogUrl].includes(url));
          return fetched(url === cleanserUrl ? productPage : catalogPage, url);
        },
      }),
  );
  assert.deepEqual(requested, [cleanserUrl, cleanserCatalogUrl]);
  assert.deepEqual(photos.photoAutomation.issues, []);
  assert.equal(
    automaticPhotoPlan(cleanserProduct, photos).imageUrl,
    cleanserPhoto,
  );
  assert.equal(
    automaticPhotoPlan({ ...cleanserProduct, volumeValue: 250 }, photos)
      .imageUrl,
    null,
  );
  assert.equal(
    automaticPhotoPlan({ ...cleanserProduct, name: "Another Cleanser" }, photos)
      .imageUrl,
    null,
  );
  const unverified = await searchVariantPhotos(
    {
      product: cleanserProduct,
      variant: { sku: cleanserProduct.supplierSku, label: "150 ml" },
      knownUrl: cleanserUrl,
      officialDomains: [],
      policies: [],
      priceCandidates: [],
      catalogOnly: true,
    },
    {
      official: async () => ({ found: false, url: null }),
      external: async () => ({ found: false, url: null }),
      fetchHtml: async (url) =>
        fetched(
          url === cleanserUrl
            ? productPage
            : Buffer.from(
                catalogPage
                  .toString()
                  .replace("JEUDERM - Avancerad", "OTHERBRAND - Avancerad"),
              ),
          url,
        ),
    },
  );
  assert.equal(unverified.status, "NOT_FOUND");
  assert.deepEqual(unverified.candidates, []);
  assert.deepEqual(
    unverified.issues.map((issue) => issue.code),
    ["photo_brand_unconfirmed"],
  );
});

test("rejected photo pages report safe reasons that survive proposal storage and reload", async () => {
  const result = await searchVariantPhotos(
    {
      product,
      variant,
      knownUrl: pageUrl,
      officialDomains: [],
      policies: [],
      priceCandidates: [],
      catalogOnly: true,
    },
    {
      official: async () => ({ found: false, url: null }),
      external: async () => ({ found: false, url: null }),
      fetchHtml: async () =>
        fetched(
          page(productNode({ name: "JeuDerm Demela Molecular Cream 150 ml" })),
        ),
    },
  );
  assert.equal(result.status, "NOT_FOUND");
  assert.deepEqual(
    result.issues.map((issue) => issue.code),
    ["photo_volume_mismatch"],
  );
  assert.match(
    proposalPhotoSearchMessages({
      photoAutomation: { issues: ["photo_volume_mismatch"] },
    })[0],
    /Объём/,
  );
  const messages = proposalPhotoSearchMessages({
    photoAutomation: {
      issues: ["ai_limit", "ai_limit", "openai_http_401:private-body"],
      incomplete: true,
    },
  });
  assert.equal(messages.length, 3);
  assert.match(messages[0], /лимит/);
  assert.ok(!messages.join(" ").includes("private-body"));
  assert.match(messages[2], /все варианты/);
  assert.deepEqual(proposalPhotoSearchMessages(null), []);
  assert.deepEqual(
    proposalPhotoSearchMessages({ photoAutomation: { issues: "invalid" } }),
    [],
  );
  assert.equal(
    typeof proposalPhotoSearchMessages({
      photoAutomation: { issues: ["__proto__", "constructor"] },
    })[0],
    "string",
  );
});
