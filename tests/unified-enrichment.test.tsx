import React from "react";
import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { VariantPhotosReview } from "../components/VariantPhotoPicker";
import {
  automaticPhotoPlan,
  commonPhotoCandidates,
  mergeAutomaticSelections,
} from "../lib/enrichment/automaticPhotos";
import { collectProposalPhotos } from "../lib/enrichment/prepareProposalPhotos";
import { removeProposalVariant } from "../lib/enrichment/removeProposalVariant";
import {
  applyProductEnrichmentProposalUniversal,
  ProposalPublicationError,
} from "../lib/enrichment/applyProposalUniversal";
import { proposalApplySchema } from "../lib/enrichment/proposalApplyInput";
import {
  removedVariantSkus,
  shouldSkipRemovedVariant,
} from "../lib/enrichment/removedVariants";
import { extractProductFromHtml } from "../lib/enrichment/extractProduct";
import { searchVariantPhotos } from "../lib/enrichment/variantPhotoSearch";
import { sanitizeProposalTitle } from "../lib/enrichment/proposalText";
import { evaluateCatalogAutopilotProposal } from "../lib/enrichment/catalogAutopilotPolicy";
import type { VariantImageGroup } from "../lib/enrichment/variantImages";
import { namePhotoKey } from "../lib/enrichment/photoIdentity";
import { STALE_ENRICHMENT_MS } from "../lib/enrichment/recoverStaleJobs";
import { pendingPhotoTargets, PHOTO_AUTOMATION_VERSION, VARIANT_PHOTO_BUDGET_MS } from "../lib/enrichment/photoAutomation";
import { prepareProposalPhotoBatches } from "../lib/enrichment/preparePhotosClient";

const variants = [
  { id: "small", label: "7", sku: "MV16", price: 1500, stock: 3 },
  { id: "large", label: "50", sku: "AG16", price: 7000, stock: 2 },
];
const product = {
  id: "p",
  name: "Маска для кожи вокруг глаз",
  image: "/seed/cream.jpg",
  variants,
  supplierSku: "MV16",
  barcode: null,
  volumeValue: 7,
  volumeUnit: "ml",
  brand: { name: "ANGIOPHARM" },
  supplier: { name: "ANGIOPHARM" },
};
const groups: VariantImageGroup[] = variants.map((variant) => ({
  variantId: variant.id,
  sku: variant.sku,
  candidates: [
    { url: `https://brand.example/${variant.sku}.jpg`, source: "WEB" },
  ],
}));

test("a missing common photo is suggested from any current variant while a saved common photo stays selected", () => {
  const current = { ...product, variants: [variants[0], { ...variants[1], image: "/media/large.jpg" }] };
  const plan = automaticPhotoPlan(current, {});
  assert.equal(plan.imageUrl, "/media/large.jpg");
  assert.deepEqual(plan.variantImages, []);
  assert.equal(commonPhotoCandidates(current, {})[0].sku, "AG16");
  const duplicate = commonPhotoCandidates({
    ...current, variants: [variants[0], { ...variants[1], image: groups[1].candidates[0].url }],
  }, { variantImageCandidates: groups });
  assert.equal(duplicate.find(row => row.url === groups[1].candidates[0].url)?.stored, true);
  assert.equal(automaticPhotoPlan({ ...current, image: "/media/current.jpg" }, {}).imageUrl, null);
  const html = renderToStaticMarkup(<VariantPhotosReview
    product={current} proposalId="proposal" facts={{}} value={[]}
    onChange={() => {}} onCommonImageChange={() => {}}
  />);
  assert.match(html, /Сделать фото варианта AG16 общим/);
  assert.match(html, /Сделать общим фото товара/);
});

test("batch SKU lookup continues to the same verified external search as a manual variant search", async () => {
  const lookedUp: string[] = [];
  const photos = await collectProposalPhotos({
    product, groups: [], knownUrl: "https://brand.example/wrong-page",
    officialDomains: [], policies: [], deadlineAt: Date.now() + 5000,
  }, input => searchVariantPhotos(input, {
    official: async () => { throw new Error("no official domains"); },
    external: async ({ product: current }) => {
      lookedUp.push(current.supplierSku!);
      return { found: true, url: "https://merchant.example/" + current.supplierSku };
    },
    fetchHtml: async (url) => {
      const sku = url.split("/").at(-1)!;
      const volume = sku === "MV16" ? 7 : 50;
      return { finalUrl: url, contentType: "text/html", status: 200, headers: {},
        buffer: Buffer.from(`<script type="application/ld+json">${JSON.stringify({
          "@type": "Product", name: `${product.name} ${volume} ml`, sku,
          brand: "ANGIOPHARM", image: `/${sku}.jpg`,
        })}</script>`),
      };
    },
  }));
  assert.deepEqual(lookedUp.sort(), ["AG16", "MV16"]);
  assert.deepEqual(photos.photoAutomation.issues, []);
  assert.deepEqual(automaticPhotoPlan(product, photos).variantImages.map(row => row.imageUrl).sort(), [
    "https://merchant.example/AG16.jpg", "https://merchant.example/MV16.jpg",
  ]);
});

test("automatic photos select exact SKU images, prefer the site, and never use an unverified common gallery", () => {
  const facts = {
    variantImageCandidates: [
      {
        ...groups[0],
        candidates: [
          { url: "https://cdn.example/price.jpg", source: "PRICE_LIST" },
          ...groups[0].candidates,
        ],
      },
      groups[1],
      {
        variantId: "large",
        sku: "OTHER",
        candidates: [{ url: "https://cdn.example/wrong.jpg", source: "WEB" }],
      },
    ],
    images: [
      "https://shop.example/logo.png",
      "https://shop.example/other-brand.jpg",
    ],
  };
  const plan = automaticPhotoPlan(product, facts);
  assert.equal(plan.imageUrl, "https://brand.example/MV16.jpg");
  assert.deepEqual(
    plan.variantImages.map((item) => [item.sku, item.imageUrl]),
    [
      ["MV16", "https://brand.example/MV16.jpg"],
      ["AG16", "https://brand.example/AG16.jpg"],
    ],
  );
  const noMatch = automaticPhotoPlan(product, { images: facts.images });
  assert.equal(noMatch.imageUrl, null);
  assert.deepEqual(noMatch.variantImages, []);
  const existing = automaticPhotoPlan(
    {
      ...product,
      image: "/common.jpg",
      variants: variants.map((variant) => ({
        ...variant,
        image: "/saved.jpg",
      })),
    },
    facts,
  );
  assert.equal(existing.imageUrl, null);
  assert.deepEqual(existing.variantImages, []);
});

test("automatic choices preserve an explicit common fallback and discard removed or changed SKUs", () => {
  const automatic = automaticPhotoPlan(product, {
    variantImageCandidates: groups,
  }).variantImages;
  const result = mergeAutomaticSelections(
    automatic,
    [{ variantId: "large", sku: "AG16", imageUrl: null }],
    variants,
  );
  assert.equal(
    result.find((item) => item.variantId === "large")?.imageUrl,
    null,
  );
  assert.deepEqual(
    mergeAutomaticSelections(automatic, [], [{ ...variants[1], sku: "NEW" }]),
    [],
  );
});

test("newly found SKU photos fill an already opened review without changing explicit choices", () => {
  const automatic = automaticPhotoPlan(product, { variantImageCandidates: groups }).variantImages;
  const opened: typeof automatic = [];
  assert.equal(mergeAutomaticSelections(automatic, opened, variants).length, 2);
  const kept = [{ variantId: "small", sku: "MV16" }];
  const current = [{ variantId: "large", sku: "AG16", imageUrl: null }];
  assert.deepEqual(mergeAutomaticSelections(automatic, current, variants, kept), current);
  // The unchanged choice is for the old SKU only.
  const replaced = [{ ...variants[0], sku: "NEW" }];
  const next = [{ variantId: "small", sku: "NEW", imageUrl: "https://cdn.example/new.jpg" }];
  assert.deepEqual(mergeAutomaticSelections(next, current, replaced, kept), next);
});

test("automatic lookup resumes beyond a two-SKU batch and does not cache a short discovery timeout as complete", async () => {
  const current = { ...product, variants: [...variants, { ...variants[0], id: "third", sku: "SKU-3" }] };
  const input = { product: current, groups: [], knownUrl: "", officialDomains: [], policies: [],
    deadlineAt: Date.now() + VARIANT_PHOTO_BUDGET_MS, maxTargets: 2 };
  const lookedUp: string[] = [];
  const lookup: Parameters<typeof collectProposalPhotos>[1] = async ({ variant }) => {
    lookedUp.push(variant.sku!);
    return { sku: variant.sku!, candidates: [{ url: `https://brand.example/${variant.sku}.jpg`, source: "WEB" }],
      issues: [], status: "FOUND" };
  };
  const first = await collectProposalPhotos(input, lookup);
  assert.equal(first.photoAutomation.incomplete, true);
  assert.equal(first.variantImageCandidates.length, 2);
  const second = await collectProposalPhotos({ ...input, groups: first.variantImageCandidates,
    previousAutomation: first.photoAutomation }, lookup);
  assert.equal(second.photoAutomation.incomplete, false);
  assert.deepEqual(lookedUp.sort(), ["AG16", "MV16", "SKU-3"]);
  assert.equal(automaticPhotoPlan(current, second).variantImages.length, 3);
  assert.deepEqual(pendingPhotoTargets(current, second), []);

  const timedOut = await collectProposalPhotos({ ...input, deadlineAt: Date.now() + 5000 }, async ({ variant }) => ({
    sku: variant.sku!, candidates: [], status: "INCOMPLETE", issues: [{ code: "search_timeout", message: "timeout" }],
  }));
  assert.equal(timedOut.photoAutomation.incomplete, true);
  assert.equal(pendingPhotoTargets(current, timedOut).length, 3);
  const absent = await collectProposalPhotos({ ...input, product, maxTargets: 2 }, async ({ variant }) => ({
    sku: variant.sku!, candidates: [], status: "NOT_FOUND", issues: [],
  }));
  assert.equal(absent.photoAutomation.incomplete, false);
  assert.equal(pendingPhotoTargets(product, absent).length, 0);
  assert.equal(pendingPhotoTargets(product, absent, Date.now() + 25 * 60 * 60_000).length, 2);
  assert.equal(pendingPhotoTargets({ ...product, variants: [...variants, current.variants[2]] }, absent).length, 1);
  assert.deepEqual(pendingPhotoTargets({ ...product, variants: [{ ...variants[0], sku: "CHANGED" }, variants[1]] }, absent)
    .map((row) => row.id), ["small", "product:p"]);
  assert.equal(pendingPhotoTargets(product, { photoAutomation: { version: PHOTO_AUTOMATION_VERSION - 1,
    checkedAt: new Date().toISOString(), incomplete: false } }).length, 2);
});

test("the browser continues persisted photo batches automatically and keeps partial progress on failure", async () => {
  const batches: unknown[] = [];
  const requests: unknown[] = [];
  let count = 0;
  const request: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    count++;
    return Response.json({ photoAutomation: { incomplete: count < 3, attempts: Array.from({ length: count }, (_, i) => ({ key: String(i) })) } });
  };
  await prepareProposalPhotoBatches("proposal", { resume: false, onBatch: (photos) => batches.push(photos) }, request);
  assert.equal(batches.length, 3);
  assert.deepEqual(requests, [{ resume: false }, { resume: true }, { resume: true }]);
  count = 0;
  const partial: unknown[] = [];
  await assert.rejects(prepareProposalPhotoBatches("proposal", { onBatch: (photos) => partial.push(photos) }, async (_url, init) => {
    assert.equal(JSON.parse(String(init?.body)).resume, true);
    if (++count === 2) return Response.json({ message: "Карточка изменилась" }, { status: 409 });
    return Response.json({ photoAutomation: { incomplete: true, attempts: [{ key: "done" }] } });
  }), /Карточка изменилась/);
  assert.equal(partial.length, 1);
  const controller = new AbortController();
  let accepted = false;
  await assert.rejects(prepareProposalPhotoBatches("proposal", {
    signal: controller.signal, onBatch: () => { accepted = true; },
  }, async () => { controller.abort(); return Response.json({}); }), /Aborted/);
  assert.equal(accepted, false);
});

test("automatic collection searches missing variants with bounded concurrency and keeps price candidates", async () => {
  let running = 0,
    peak = 0;
  const lookedUp: string[] = [];
  const price: VariantImageGroup = {
    variantId: "large",
    sku: "AG16",
    candidates: [
      { url: "https://price.example/AG16.jpg", source: "PRICE_LIST" },
    ],
  };
  const photos = await collectProposalPhotos(
    {
      product,
      groups: [price],
      knownUrl: "https://brand.example/mask",
      officialDomains: ["brand.example"],
      policies: [],
      deadlineAt: Date.now() + 5000,
    },
    async (input) => {
      running++;
      peak = Math.max(peak, running);
      lookedUp.push(input.variant.sku!);
      assert.equal(input.catalogOnly, false);
      await Promise.resolve();
      running--;
      return {
        sku: input.variant.sku!,
        status: "FOUND",
        issues: [],
        candidates:
          input.variant.sku === "MV16"
            ? groups[0].candidates
            : input.priceCandidates,
      };
    },
  );
  assert.deepEqual(lookedUp.sort(), ["AG16", "MV16"]);
  assert.ok(peak <= 2);
  const plan = automaticPhotoPlan(product, photos);
  assert.equal(
    plan.variantImages.find((item) => item.sku === "AG16")?.imageUrl,
    price.candidates[0].url,
  );
  const kept = await collectProposalPhotos(
    {
      product,
      groups: [price],
      knownUrl: "",
      officialDomains: [],
      policies: [],
      deadlineAt: Date.now() - 1,
    },
    async () => {
      throw new Error("must not run");
    },
  );
  assert.equal(kept.photoAutomation.incomplete, true);
  assert.equal(
    kept.variantImageCandidates[0].candidates[0].url,
    price.candidates[0].url,
  );
});

test("automatic catalog lookup never triggers an AI request when a SKU is absent", async () => {
  const result = await searchVariantPhotos(
    {
      product,
      variant: variants[1],
      officialDomains: ["angiopharm.com"],
      policies: [],
      priceCandidates: [],
      catalogOnly: true,
    },
    {
      official: async () => {
        throw new Error("AI must not run");
      },
      external: async () => {
        throw new Error("AI must not run");
      },
      fetchHtml: async (url) => ({
        buffer: Buffer.from('<main id="content"><p>Не найдено</p></main>'),
        finalUrl: url,
        contentType: "text/html",
        status: 200,
        headers: {},
      }),
    },
  );
  assert.equal(result.status, "NOT_FOUND");
  assert.deepEqual(result.candidates, []);
});

test("product photos in an icons directory survive while logos, stubs and recommendations are excluded", () => {
  const extracted = extractProductFromHtml({
    finalUrl: "https://cosmogid.ru/store/mask",
    buffer: Buffer.from(`
    <meta property="og:image" content="/uploadedFiles/eshopimages/icons/350x350/mask.png">
    <main><h1>Маска</h1><picture><img src="/img/stub.png"></picture>
    <div class="recommendations"><img src="/unrelated-academie.jpg"></div>
    <div class="product-gallery"><img src="/logo.png"><img src="/photo-back.jpg"></div></main>`),
  });
  assert.deepEqual(extracted.images, [
    "https://cosmogid.ru/uploadedFiles/eshopimages/icons/350x350/mask.png",
    "https://cosmogid.ru/photo-back.jpg",
  ]);
  assert.equal(
    sanitizeProposalTitle(
      "ANGIOPHARM - Крем MAX, 50 мл - Студия красоты 9 Ангелов",
    ),
    "ANGIOPHARM - Крем MAX, 50 мл",
  );
});

test("the official Cloud Zoom gallery supplies original photos without collecting recommendations", () => {
  const extracted = extractProductFromHtml({
    finalUrl: "https://angiopharm.com/510-tonik",
    buffer: Buffer.from(`
    <main id="content"><div class="product-zoom-image"><a class="cloud-zoom main-image" id="product-cloud-zoom" href="/image/catalog/products/AG01_1.jpg"><img src="/thumb.jpg"></a></div>
    <div class="additional-images"><a class="cloud-zoom-gallery sub-image" href="/image/catalog/products/AG01.jpg"><img src="/thumb2.jpg"></a></div>
    <div class="product-layout"><img src="/unrelated.jpg"></div></main>`),
  });
  assert.ok(
    extracted.images.includes(
      "https://angiopharm.com/image/catalog/products/AG01_1.jpg",
    ),
  );
  assert.ok(
    extracted.images.includes(
      "https://angiopharm.com/image/catalog/products/AG01.jpg",
    ),
  );
  assert.ok(!extracted.images.includes("https://angiopharm.com/unrelated.jpg"));
});

function deletionFixture() {
  let state: any = {
    product: {
      ...structuredClone(product),
      price: 1500,
      stock: 5,
      supplierId: "supplier",
      brandId: "brand",
      category: "Уход за лицом",
      isPublished: false,
      enrichmentStatus: "REVIEW",
      sourceUrl: "https://brand.example/small",
      updatedAt: new Date(1000),
    },
    proposals: [
      {
        id: "proposal",
        productId: "p",
        status: "PENDING",
        confidence: 26,
        shortDescription: "Омолаживающая маска для кожи вокруг глаз.",
        description: "Маска для ухода за кожей вокруг глаз.",
        sourceUrl: "https://brand.example/small",
        jobId: "job",
        images: groups.flatMap((group) =>
          group.candidates.map((candidate) => candidate.url),
        ),
        updatedAt: new Date(1000),
        facts: { variantImageCandidates: groups, keep: "text" },
      },
    ],
  };
  state.jobs = [{ id: "job", productId: "p", status: "REVIEW", updatedAt: new Date() }];
  const flags = { failProduct: false, failProposal: false, failCleanup: false };
  let clock = 2000;
  function db(get: () => any): any {
    return {
      product: {
        findUnique: async () => structuredClone(get().product),
        findUniqueOrThrow: async () => structuredClone(get().product),
        update: async ({ data }: any) =>
          Object.assign(get().product, structuredClone(data)),
        updateMany: async ({ where, data }: any) => {
          if (where.enrichmentJobs) {
            const row = get().product;
            const active = get().jobs.some((job: any) =>
              job.productId === row.id && where.enrichmentJobs.none.status.in.includes(job.status),
            );
            if (!where.id.in.includes(row.id) || row.enrichmentStatus !== where.enrichmentStatus ||
              !(+row.updatedAt < +where.updatedAt.lt) || active) return { count: 0 };
            Object.assign(row, structuredClone(data), { updatedAt: new Date(clock++) });
            return { count: 1 };
          }
          if (
            flags.failProduct ||
            +where.updatedAt !== +get().product.updatedAt ||
            where.enrichmentStatus?.notIn.includes(get().product.enrichmentStatus)
          )
            return { count: 0 };
          Object.assign(get().product, structuredClone(data), {
            updatedAt: new Date(clock++),
          });
          return { count: 1 };
        },
      },
      productEnrichmentProposal: {
        findUnique: async ({ where }: any) =>
          get().proposals.some((row: any) => row.id === where.id)
            ? structuredClone({
                ...get().proposals.find((row: any) => row.id === where.id),
                product: get().product,
              })
            : null,
        count: async ({ where }: any) =>
          get().proposals.filter((row: any) =>
            row.productId === where.productId && row.status === where.status &&
            (!where.confidence || row.confidence > where.confidence.gt),
          ).length,
        findMany: async () =>
          structuredClone(
            get().proposals.filter((row: any) => row.status === "PENDING"),
          ),
        updateMany: async ({ where, data }: any) => {
          if (flags.failCleanup && typeof where.id === "object")
            throw new Error("cleanup_failed");
          if (flags.failProposal) return { count: 0 };
          const rows = get().proposals.filter((row: any) =>
            row.status === where.status &&
            (!where.productId || row.productId === where.productId) &&
            (typeof where.id === "string" ? row.id === where.id : row.id !== where.id?.not) &&
            (!where.updatedAt || +row.updatedAt === +where.updatedAt),
          );
          rows.forEach((row: any) => Object.assign(row, structuredClone(data), {
            updatedAt: new Date(clock++),
          }));
          return { count: rows.length };
        },
      },
      enrichmentJob: {
        findFirst: async ({ where }: any) => get().jobs.find((row: any) =>
          row.productId === where.productId && where.status.in.includes(row.status),
        ) || null,
        update: async ({ where, data }: any) => Object.assign(
          get().jobs.find((row: any) => row.id === where.id), structuredClone(data),
        ),
        updateMany: async ({ where, data }: any) => {
          const rows = get().jobs.filter((row: any) => {
            if (where.OR) return where.productId.in.includes(row.productId) &&
              +row.updatedAt < +where.updatedAt.lt &&
              where.OR.some((condition: any) => row.status === condition.status &&
                (!condition.scheduledAt || +row.scheduledAt < +condition.scheduledAt.lt));
            return row.productId === where.productId && row.status === where.status;
          });
          rows.forEach((row: any) => Object.assign(row, structuredClone(data)));
          return { count: rows.length };
        },
      },
      productImage: {
        updateMany: async () => ({ count: 1 }),
        update: async () => ({}),
      },
      $transaction: async (callback: (tx: any) => Promise<any>) => {
        const draft = structuredClone(state);
        const result = await callback(db(() => draft));
        state = draft;
        return result;
      },
    };
  }
  return {
    database: db(() => state),
    flags,
    get state() {
      return state;
    },
  };
}
const remove = {
  productId: "p",
  proposalId: "proposal",
  variantId: "small",
  sku: "MV16",
};

test("publication requires a complete manual apply and cannot be enabled by automatic enrichment", async () => {
  assert.equal(proposalApplySchema.safeParse({ publishNow: true }).success, true);
  for (const mode of ["DESCRIPTION", "DESCRIPTION_FINAL", "IMAGE", "INVENTORY"])
    assert.equal(proposalApplySchema.safeParse({ mode, publishNow: true }).success, false);
  assert.equal(proposalApplySchema.safeParse({ mode: "IMAGE", publishNow: false }).success, true);
  assert.equal(proposalApplySchema.safeParse({ publishNow: "true" }).success, false);
  const f = deletionFixture();
  const before = structuredClone(f.state);
  await assert.rejects(applyProductEnrichmentProposalUniversal({
    proposalId: "proposal", mode: "ALL", publishNow: true, automatic: true,
  }, { database: f.database }), /publication_full_review_required/);
  assert.deepEqual(f.state, before);
});

test("publishing an AI proposal atomically saves text, SKU photos and stocks and retires only this card's older reviews", async () => {
  const f = deletionFixture();
  const original = structuredClone(f.state.proposals[0]);
  f.state.proposals.push(
    { ...original, id: "older", jobId: "old-job" },
    { ...original, id: "unrelated", productId: "other", jobId: "other-job" },
  );
  f.state.jobs.push(
    { id: "old-job", productId: "p", status: "REVIEW" },
    { id: "other-job", productId: "other", status: "REVIEW" },
  );
  const beforeVariants = structuredClone(f.state.product.variants);
  let uploads = 0;
  const result = await applyProductEnrichmentProposalUniversal({
    proposalId: "proposal", mode: "ALL", publishNow: true,
    imageUrl: groups[1].candidates[0].url,
    variantImages: [{ variantId: "large", sku: "AG16", imageUrl: groups[1].candidates[0].url }],
    variantStocks: { large: 7 },
  }, {
    database: f.database, loadPriceImages: async () => new Map(),
    importImage: async () => { uploads++; return { id: "media", url: "https://media.example/large.jpg" } as any; },
  });
  assert.equal(uploads, 1);
  assert.equal(result.proposal?.product.isPublished, true);
  assert.equal(f.state.product.enrichmentStatus, "READY");
  assert.equal(f.state.product.shortDescription, original.shortDescription);
  assert.equal(f.state.product.description, original.description);
  assert.equal(f.state.product.image, "https://media.example/large.jpg");
  assert.equal(f.state.product.variants[1].image, f.state.product.image);
  assert.equal(f.state.product.variants[1].stock, 7);
  assert.deepEqual(f.state.product.variants[0], beforeVariants[0]);
  assert.equal(f.state.product.stock, 10);
  assert.equal(f.state.product.price, 1500);
  assert.deepEqual(f.state.proposals.map((row: any) => row.status), ["APPLIED", "REJECTED", "PENDING"]);
  assert.deepEqual(f.state.jobs.map((row: any) => row.status), ["APPLIED", "CANCELED", "REVIEW"]);
});

test("a missing photo, brand, category or price keeps an AI proposal pending and the product unpublished", async () => {
  for (const [field, value, missing] of [
    ["image", "/seed/cream.jpg", "фотография"],
    ["brandId", null, "бренд"],
    ["category", "", "категория"],
    ["price", 0, "цена"],
  ]) {
    const f = deletionFixture();
    f.state.product.image = "/media/current.jpg";
    f.state.product[String(field)] = value;
    const before = structuredClone(f.state);
    await assert.rejects(applyProductEnrichmentProposalUniversal({
      proposalId: "proposal", mode: "ALL", publishNow: true,
    }, { database: f.database }), (error: unknown) => {
      assert.ok(error instanceof ProposalPublicationError);
      assert.deepEqual(error.missing, [missing]);
      return true;
    });
    assert.deepEqual(f.state, before);
  }
});

test("publication with a saved common photo needs no new download and also supports cards without variants", async () => {
  const f = deletionFixture();
  f.state.product.image = "/media/current.jpg";
  f.state.product.variants = [];
  await applyProductEnrichmentProposalUniversal({
    proposalId: "proposal", mode: "ALL", publishNow: true, stock: 8,
  }, {
    database: f.database,
    importImage: async () => { throw new Error("saved photo must not be downloaded"); },
  });
  assert.equal(f.state.product.isPublished, true);
  assert.equal(f.state.product.stock, 8);
  assert.equal(f.state.product.price, 1500);
  assert.equal(f.state.product.image, "/media/current.jpg");
});

test("publication failures and competing edits roll back application, cleanup and publication together", async () => {
  for (const condition of ["upload", "cleanup", "product-race", "proposal-race", "job", "running", "merged"]) {
    const f = deletionFixture();
    if (condition === "cleanup") f.flags.failCleanup = true;
    if (condition === "product-race") f.flags.failProduct = true;
    if (condition === "proposal-race") f.flags.failProposal = true;
    if (condition === "job") f.state.jobs.push({ id: "active", productId: "p", status: "RUNNING" });
    if (condition === "running") {
      f.state.product.enrichmentStatus = "RUNNING";
      f.state.product.updatedAt = new Date();
    }
    if (condition === "merged") f.state.product.enrichmentStatus = "MERGED";
    const before = structuredClone(f.state);
    await assert.rejects(applyProductEnrichmentProposalUniversal({
      proposalId: "proposal", mode: "ALL", publishNow: true, imageUrl: groups[0].candidates[0].url,
    }, {
      database: f.database,
      importImage: async () => {
        if (condition === "upload") throw new Error("upload_failed");
        return { id: "media", url: "https://media.example/small.jpg" } as any;
      },
    }));
    assert.deepEqual(f.state, before, condition);
  }
});

test("publishing recovers only this product's expired jobs and orphaned search claim", async () => {
  for (const kind of ["orphan", "RUNNING", "PENDING"]) {
    const f = deletionFixture();
    const staleAt = new Date(Date.now() - STALE_ENRICHMENT_MS - 60_000);
    f.state.product.image = "/media/current.jpg";
    f.state.product.enrichmentStatus = "RUNNING";
    f.state.product.updatedAt = staleAt;
    if (kind !== "orphan") f.state.jobs.push({
      id: "expired", productId: "p", status: kind,
      updatedAt: staleAt, scheduledAt: staleAt,
    });
    const unrelated = {
      id: "unrelated", productId: "other", status: "RUNNING", updatedAt: staleAt,
    };
    f.state.jobs.push(structuredClone(unrelated));
    await applyProductEnrichmentProposalUniversal({
      proposalId: "proposal", mode: "ALL", publishNow: true,
    }, { database: f.database });
    assert.equal(f.state.product.isPublished, true, kind);
    assert.equal(f.state.product.enrichmentStatus, "READY", kind);
    if (kind !== "orphan") {
      const expired = f.state.jobs.find((row: any) => row.id === "expired");
      assert.equal(expired.status, "FAILED");
      assert.equal(expired.error, "stale_enrichment_job_recovered");
    }
    assert.deepEqual(f.state.jobs.find((row: any) => row.id === "unrelated"), unrelated);
  }
});

test("publishing cannot recover an active job or a future scheduled search", async () => {
  for (const kind of ["RUNNING", "PENDING"]) {
    const f = deletionFixture();
    const staleAt = new Date(Date.now() - STALE_ENRICHMENT_MS - 60_000);
    f.state.product.image = "/media/current.jpg";
    f.state.product.enrichmentStatus = "RUNNING";
    f.state.product.updatedAt = staleAt;
    f.state.jobs.push({
      id: "active", productId: "p", status: kind,
      updatedAt: kind === "RUNNING" ? new Date() : staleAt,
      scheduledAt: new Date(Date.now() + 86_400_000),
    });
    const before = structuredClone(f.state);
    await assert.rejects(applyProductEnrichmentProposalUniversal({
      proposalId: "proposal", mode: "ALL", publishNow: true,
    }, { database: f.database }), /publication_enrichment_running/);
    assert.deepEqual(f.state, before);
  }
});

test("a verified sibling SKU photo can become common and own photo with one upload and no inventory changes", async () => {
  const f = deletionFixture();
  f.state.proposals[0].images = [];
  const before = structuredClone(f.state.product);
  let uploads = 0;
  await applyProductEnrichmentProposalUniversal({
    proposalId: "proposal", mode: "ALL", imageUrl: groups[1].candidates[0].url,
    variantImages: [{ variantId: "large", sku: "AG16", imageUrl: groups[1].candidates[0].url }],
  }, {
    database: f.database, loadPriceImages: async () => new Map(),
    importImage: async () => { uploads++; return { id: "media", url: "https://media.example/large.jpg" } as any; },
  });
  assert.equal(uploads, 1);
  assert.equal(f.state.product.image, "https://media.example/large.jpg");
  assert.equal(f.state.product.variants[1].image, f.state.product.image);
  assert.equal(f.state.product.variants[0].image, undefined);
  for (const key of ["price", "stock", "supplierSku", "isPublished"]) assert.equal(f.state.product[key], before[key]);
});

test("promoting a stored variant photo reuses its URL and preserves every SKU photo, price and stock", async () => {
  const f = deletionFixture();
  f.state.product.variants[1].image = "/media/approved-large.jpg";
  const before = structuredClone(f.state.product);
  const plan = automaticPhotoPlan(f.state.product, {});
  assert.equal(plan.imageUrl, "/media/approved-large.jpg");
  assert.equal(proposalApplySchema.parse({ imageUrl: plan.imageUrl }).imageUrl, plan.imageUrl);
  await applyProductEnrichmentProposalUniversal({
    proposalId: "proposal", mode: "IMAGE", imageUrl: plan.imageUrl,
  }, { database: f.database, importImage: async () => { throw new Error("stored photo must not be downloaded again"); } });
  assert.equal(f.state.product.image, plan.imageUrl);
  assert.deepEqual(f.state.product.variants, before.variants);
  for (const key of ["price", "stock", "supplierSku", "isPublished"]) assert.equal(f.state.product[key], before[key]);
});

test("promotion of a non-primary photo fails if its SKU changes during upload", async () => {
  const f = deletionFixture();
  await assert.rejects(applyProductEnrichmentProposalUniversal({
    proposalId: "proposal", mode: "IMAGE", imageUrl: groups[1].candidates[0].url,
  }, {
    database: f.database,
    importImage: async () => {
      f.state.product.variants[1].sku = "AG17";
      f.state.product.updatedAt = new Date(5000);
      return { id: "media", url: "https://media.example/large.jpg" } as any;
    },
  }), /variant_sku_changed/);
  assert.equal(f.state.product.image, product.image);
  assert.equal(f.state.product.variants[1].image, undefined);
  assert.equal(f.state.proposals[0].status, "PENDING");
});

test("an explicit decision to keep the current common photo still saves text and each SKU photo", async () => {
  const f = deletionFixture();
  const plan = automaticPhotoPlan(f.state.product, {
    variantImageCandidates: [groups[1]],
  });
  assert.equal(plan.imageUrl, groups[1].candidates[0].url);
  const parsed = proposalApplySchema.parse(
    JSON.parse(
      JSON.stringify({
        mode: "ALL",
        imageUrl: null,
        variantImages: plan.variantImages,
      }),
    ),
  );
  assert.equal(parsed.mode, "ALL");
  assert.equal(parsed.imageUrl, null);
  const before = structuredClone(f.state.product);
  const result = await applyProductEnrichmentProposalUniversal(
    {
      proposalId: "proposal",
      ...parsed,
      mode: "ALL",
    },
    {
      database: f.database,
      loadPriceImages: async () => new Map(),
      importImage: async ({ sourceUrl }) => {
        assert.equal(sourceUrl, groups[1].candidates[0].url);
        return { id: "photo", url: "https://media.example/AG16.jpg" } as any;
      },
    },
  );
  assert.equal(f.state.proposals[0].status, "APPLIED");
  assert.equal(
    f.state.product.shortDescription,
    f.state.proposals[0].shortDescription,
  );
  assert.equal(f.state.product.description, f.state.proposals[0].description);
  assert.equal(
    result.proposal?.product.description,
    f.state.product.description,
  );
  assert.equal(f.state.product.image, before.image);
  assert.equal(f.state.product.variants[0].image, undefined);
  assert.equal(
    f.state.product.variants[1].image,
    "https://media.example/AG16.jpg",
  );
  assert.equal(f.state.product.supplierSku, before.supplierSku);
  assert.equal(f.state.product.price, before.price);
  assert.equal(f.state.product.stock, before.stock);
  assert.deepEqual(
    f.state.product.variants.map(({ id, label, sku, price, stock }: any) => ({
      id,
      label,
      sku,
      price,
      stock,
    })),
    before.variants,
  );
});

test("photo selection accepts an unchanged common photo but still rejects malformed variant assignments", () => {
  for (const imageUrl of [
    null,
    undefined,
    "",
    "https://brand.example/photo.jpg",
  ])
    assert.equal(
      proposalApplySchema.safeParse({ mode: "ALL", imageUrl }).success,
      true,
    );
  for (const body of [
    { imageUrl: 1 },
    { imageUrl: "not-a-url" },
    { imageUrl: "//another.example/photo.jpg" },
    { imageUrl: "file:///private.jpg" },
    { imageUrl: "javascript:alert(1)" },
    { variantImages: [{ variantId: "large", sku: "", imageUrl: null }] },
    {
      variantImages: [
        { variantId: "large", sku: "AG16", imageUrl: "/local.jpg" },
      ],
    },
    { stock: -1 },
  ])
    assert.equal(proposalApplySchema.safeParse(body).success, false);
});

test("deleting the primary variant then applying the remaining SKU photo and stock succeeds", async () => {
  const f = deletionFixture();
  await removeProposalVariant(remove, f.database);
  const proposal = f.state.proposals[0];
  assert.deepEqual(proposal.images, []);
  const plan = automaticPhotoPlan(f.state.product, proposal.facts);
  assert.equal(plan.imageUrl, "https://brand.example/AG16.jpg");
  const uploads: string[] = [];
  await applyProductEnrichmentProposalUniversal(
    {
      proposalId: proposal.id,
      mode: "ALL",
      imageUrl: plan.imageUrl,
      variantImages: plan.variantImages,
      variantStocks: { large: 3 },
    },
    {
      database: f.database,
      loadPriceImages: async () => new Map(),
      loadCommonPriceImage: async () => null,
      importImage: async (input) => {
        uploads.push(input.sourceUrl);
        return {
          id: "ag16-media",
          url: "https://media.example/AG16.jpg",
        } as any;
      },
    },
  );
  assert.equal(f.state.proposals[0].status, "APPLIED");
  assert.equal(f.state.product.image, "https://media.example/AG16.jpg");
  assert.equal(f.state.product.variants.length, 1);
  assert.equal(f.state.product.variants[0].sku, "AG16");
  assert.equal(f.state.product.variants[0].image, f.state.product.image);
  assert.equal(f.state.product.variants[0].stock, 3);
  assert.equal(f.state.product.stock, 3);
  assert.equal(f.state.product.price, 7000);
  assert.equal(f.state.product.isPublished, false);
  assert.deepEqual(uploads, ["https://brand.example/AG16.jpg"]);
  assert.deepEqual(removedVariantSkus(f.state.proposals[0].facts), ["MV16"]);
});

test("a photo belonging to a removed variant or another product cannot become the common photo", async () => {
  for (const target of ["removed", "foreign-product"]) {
    const f = deletionFixture();
    const proposal = f.state.proposals[0];
    proposal.images = [];
    let imageUrl = "https://brand.example/AG16.jpg";
    if (target === "removed") {
      proposal.facts.variantImageCandidates = [
        { ...groups[0], variantId: "deleted-id" },
      ];
      imageUrl = groups[0].candidates[0].url;
    }
    if (target === "foreign-product") {
      proposal.facts.variantImageCandidates = [];
      proposal.facts.productImageCandidates = [
        { ...groups[0], variantId: "product:someone-else" },
      ];
      imageUrl = groups[0].candidates[0].url;
    }
    const before = structuredClone(f.state);
    let uploads = 0;
    await assert.rejects(
      applyProductEnrichmentProposalUniversal(
        { proposalId: "proposal", mode: "ALL", imageUrl },
        {
          database: f.database,
          loadCommonPriceImage: async () => null,
          importImage: async () => {
            uploads++;
            throw new Error("must not upload");
          },
        },
      ),
      /proposal_image_not_allowed/,
    );
    assert.equal(uploads, 0);
    assert.deepEqual(f.state, before);
    assert.equal(
        automaticPhotoPlan(f.state.product, proposal.facts).imageUrl,
        null,
      );
  }
});

test("a confirmed primary product photo is accepted without a legacy image gallery", async () => {
  const f = deletionFixture();
  f.state.product.variants = [];
  f.state.proposals[0].images = [];
  f.state.proposals[0].facts = {
    productImageCandidates: [{ ...groups[0], variantId: "product:p" }],
  };
  const plan = automaticPhotoPlan(f.state.product, f.state.proposals[0].facts);
  await applyProductEnrichmentProposalUniversal(
    { proposalId: "proposal", mode: "ALL", imageUrl: plan.imageUrl, stock: 3 },
    {
      database: f.database,
      importImage: async () =>
        ({ id: "media", url: "https://media.example/MV16.jpg" }) as any,
      loadCommonPriceImage: async () => {
        throw new Error("confirmed SKU photo must not need a price row");
      },
    },
  );
  assert.equal(f.state.product.image, "https://media.example/MV16.jpg");
  assert.equal(f.state.product.stock, 3);
  assert.equal(f.state.proposals[0].status, "APPLIED");
});

test("a primary SKU changed during upload cannot receive the old SKU photo even during manual application", async () => {
  const f = deletionFixture();
  await removeProposalVariant(remove, f.database);
  const plan = automaticPhotoPlan(f.state.product, f.state.proposals[0].facts);
  await assert.rejects(
    applyProductEnrichmentProposalUniversal(
      { proposalId: "proposal", mode: "ALL", imageUrl: plan.imageUrl },
      {
        database: f.database,
        loadCommonPriceImage: async () => null,
        importImage: async () => {
          f.state.product.supplierSku = "AG17";
          f.state.product.variants[0].sku = "AG17";
          f.state.product.updatedAt = new Date(5000);
          return { id: "media", url: "https://media.example/AG16.jpg" } as any;
        },
      },
    ),
    /variant_sku_changed/,
  );
  assert.equal(f.state.product.supplierSku, "AG17");
  assert.equal(f.state.product.variants[0].image, undefined);
  assert.equal(f.state.product.image, "/seed/cream.jpg");
  assert.equal(f.state.product.stock, 2);
  assert.equal(f.state.proposals[0].status, "PENDING");
});

function namedApplicationFixture() {
  const f = deletionFixture();
  Object.assign(f.state.product, {
    name: "Demela Molecular Cream",
    brandId: "jeuderm",
    brand: { name: "JeuDerm" },
    supplierSku: "JD-01ABCDE",
    volumeValue: 50,
    volumeUnit: "ml",
    image: "",
    variants: [],
  });
  const candidate = {
    url: "https://brand.example/demela-50.jpg",
    source: "WEB" as const,
    identityKey: namePhotoKey(f.state.product),
  };
  f.state.proposals[0].images = [candidate.url];
  f.state.proposals[0].facts = {
    productImageCandidates: [
      {
        variantId: "product:p",
        sku: f.state.product.supplierSku,
        candidates: [candidate],
      },
    ],
  };
  return {
    ...f,
    get state() {
      return f.state;
    },
    candidate,
  };
}

test("applying a verified name-based common photo saves text and preserves price, stock and publication", async () => {
  for (const sku of ["JD-01ABCDE", null]) {
    const f = namedApplicationFixture();
    f.state.product.supplierSku = sku;
    f.state.proposals[0].facts.productImageCandidates[0].sku = sku || "";
    const plan = automaticPhotoPlan(
      f.state.product,
      f.state.proposals[0].facts,
    );
    assert.equal(plan.imageUrl, f.candidate.url);
    const before = structuredClone(f.state.product);
    await applyProductEnrichmentProposalUniversal(
      {
        proposalId: "proposal",
        mode: "ALL",
        imageUrl: plan.imageUrl,
      },
      {
        database: f.database,
        importImage: async () =>
          ({ id: "media", url: "https://media.example/demela.jpg" }) as any,
      },
    );
    assert.equal(f.state.product.image, "https://media.example/demela.jpg");
    assert.equal(f.state.product.description, f.state.proposals[0].description);
    assert.equal(f.state.product.price, before.price);
    assert.equal(f.state.product.stock, before.stock);
    assert.equal(f.state.product.isPublished, before.isPublished);
    assert.equal(f.state.proposals[0].status, "APPLIED");
  }
});

test("legacy proposal image arrays cannot bypass a stale name, brand or volume fingerprint", async () => {
  for (const change of [
    { name: "Demela Molecular Oil" },
    { brandId: "different-brand" },
    { volumeValue: 150 },
  ]) {
    const f = namedApplicationFixture();
    Object.assign(f.state.product, change);
    assert.equal(
      automaticPhotoPlan(f.state.product, f.state.proposals[0].facts).imageUrl,
      null,
    );
    await assert.rejects(
      applyProductEnrichmentProposalUniversal(
        {
          proposalId: "proposal",
          mode: "ALL",
          imageUrl: f.candidate.url,
        },
        {
          database: f.database,
          importImage: async () => {
            throw new Error("must not upload");
          },
        },
      ),
      /product_changed_refresh/,
    );
    assert.equal(f.state.product.image, "");
    assert.equal(f.state.proposals[0].status, "PENDING");
  }
});

test("identity changed during a named-photo upload rolls back text, photo and proposal status", async () => {
  for (const change of [
    { name: "Demela Molecular Oil" },
    { brandId: "different-brand" },
    { volumeValue: 150 },
  ]) {
    const f = namedApplicationFixture();
    await assert.rejects(
      applyProductEnrichmentProposalUniversal(
        {
          proposalId: "proposal",
          mode: "ALL",
          imageUrl: f.candidate.url,
        },
        {
          database: f.database,
          importImage: async () => {
            Object.assign(f.state.product, change);
            return {
              id: "media",
              url: "https://media.example/demela.jpg",
            } as any;
          },
        },
      ),
      /product_changed_refresh/,
    );
    assert.equal(f.state.product.description, undefined);
    assert.equal(f.state.product.image, "");
    assert.equal(f.state.proposals[0].status, "PENDING");
  }
});

test("a synthetic-SKU variant cannot receive a named photo after its label changes during upload", async () => {
  const f = namedApplicationFixture();
  const variant = {
    id: "cream50",
    sku: "JD-01ABCDE",
    label: "50 ml",
    price: 1500,
    stock: 5,
  };
  f.state.product.variants = [variant];
  f.candidate.identityKey = namePhotoKey(f.state.product, variant);
  f.state.proposals[0].facts = {
    variantImageCandidates: [
      { variantId: variant.id, sku: variant.sku, candidates: [f.candidate] },
    ],
  };
  await assert.rejects(
    applyProductEnrichmentProposalUniversal(
      {
        proposalId: "proposal",
        mode: "ALL",
        variantImages: [
          {
            variantId: variant.id,
            sku: variant.sku,
            imageUrl: f.candidate.url,
          },
        ],
      },
      {
        database: f.database,
        loadPriceImages: async () => new Map(),
        importImage: async () => {
          f.state.product.variants[0].label = "150 ml";
          return {
            id: "media",
            url: "https://media.example/demela.jpg",
          } as any;
        },
      },
    ),
    /variant_image_not_allowed/,
  );
  assert.equal(f.state.product.variants[0].image, undefined);
  assert.equal(f.state.product.description, undefined);
  assert.equal(f.state.proposals[0].status, "PENDING");
});

test("deletion updates SKU, minimum price and total stock, preserves history, and removes photo choices only for that variant", async () => {
  const f = deletionFixture();
  await removeProposalVariant(remove, f.database);
  assert.deepEqual(f.state.product.variants, [variants[1]]);
  assert.equal(f.state.product.stock, 2);
  assert.equal(f.state.product.price, 7000);
  assert.equal(f.state.product.supplierSku, "AG16");
  assert.equal(f.state.product.volumeValue, 50);
  assert.equal(f.state.product.sourceUrl, null);
  const facts = f.state.proposals[0].facts;
  assert.deepEqual(facts.variantImageCandidates, [groups[1]]);
  assert.deepEqual(removedVariantSkus(facts), ["MV16"]);
  assert.equal(facts.removedVariants[0].sku, "MV16");
  assert.equal(facts.keep, "text");
  assert.equal(facts.manualVariantReviewRequired, true);
});

test("wrong SKU, wrong proposal, last variant and competing writes cannot partially delete a variant", async () => {
  for (const scenario of [
    "sku",
    "proposal",
    "last",
    "product-race",
    "proposal-race",
  ]) {
    const f = deletionFixture();
    if (scenario === "last") f.state.product.variants = [variants[0]];
    if (scenario === "product-race") f.flags.failProduct = true;
    if (scenario === "proposal-race") f.flags.failProposal = true;
    const before = structuredClone(f.state);
    await assert.rejects(
      removeProposalVariant(
        {
          ...remove,
          ...(scenario === "sku" ? { sku: "OTHER" } : {}),
          ...(scenario === "proposal" ? { proposalId: "wrong" } : {}),
        },
        f.database,
      ),
    );
    assert.deepEqual(f.state, before);
  }
});

test("future imports skip deleted SKUs while an explicit restoration wins over history", () => {
  const excluded = new Set(
    removedVariantSkus({ removedVariantSkus: [" mv16 ", "AV-02"] }),
  );
  assert.equal(
    shouldSkipRemovedVariant("MV16", excluded, new Set(["AG16"])),
    true,
  );
  assert.equal(shouldSkipRemovedVariant("AV02", excluded, new Set()), false);
  assert.equal(
    shouldSkipRemovedVariant("MV16", excluded, new Set(["MV16"])),
    false,
  );
  const evaluation = evaluateCatalogAutopilotProposal(
    { confidence: 99, manualVariantEdited: true },
    { enabled: true, minConfidence: 90 },
  );
  assert.equal(evaluation.decision, "REVIEW");
  assert.deepEqual(evaluation.reasons, ["manual_variant_review_required"]);
});

test("variant stock and deletion controls are rendered alongside each exact SKU and the common fallback", () => {
  const html = renderToStaticMarkup(
    <VariantPhotosReview
      product={product}
      proposalId="proposal"
      facts={{}}
      value={[]}
      onChange={() => {}}
      onRemove={() => {}}
      onStockChange={() => {}}
    />,
  );
  assert.equal((html.match(/Удалить вариант/g) || []).length, 2);
  assert.match(html, /Остаток SKU MV16/);
  assert.match(html, /Остаток SKU AG16/);
  assert.match(html, /Использовать общее фото/);
  assert.ok(!html.includes('src="/seed/'));
});
