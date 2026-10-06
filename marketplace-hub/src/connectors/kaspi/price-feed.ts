import { z } from "zod";

const availabilitySchema = z.object({
  available: z.boolean(),
  storeId: z.string().trim().min(1),
  stockCount: z.number().int().min(0),
  preorderDays: z.number().int().min(1).max(30).optional(),
});

const offerSchema = z
  .object({
    sku: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9]+$/),
    model: z.string().trim().min(1),
    brand: z.string().trim().min(1),
    price: z.number().int().positive().optional(),
    cityPrices: z
      .array(
        z.object({
          cityId: z.string().trim().min(1),
          price: z.number().int().positive(),
        }),
      )
      .optional(),
    availabilities: z.array(availabilitySchema).min(1),
  })
  .superRefine((value, ctx) => {
    const hasPrice = typeof value.price === "number";
    const hasCityPrices = Boolean(value.cityPrices?.length);

    if (hasPrice === hasCityPrices) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Use either price or cityPrices, but not both",
      });
    }
  });

export const kaspiPriceFeedSchema = z.object({
  company: z.string().trim().min(1),
  merchantId: z.string().trim().min(1),
  date: z.string().trim().min(1).optional(),
  offers: z.array(offerSchema).min(1),
});

export type KaspiPriceFeedInput = z.infer<typeof kaspiPriceFeedSchema>;

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildKaspiPriceFeed(input: KaspiPriceFeedInput) {
  const data = kaspiPriceFeedSchema.parse(input);
  const date = data.date ?? new Date().toISOString();

  const offers = data.offers
    .map((offer) => {
      const availabilityXml = offer.availabilities
        .map((item) => {
          const preorder =
            item.preorderDays === undefined
              ? ""
              : ` preOrder="${item.preorderDays}"`;

          return `        <availability available="${item.available ? "yes" : "no"}" storeId="${escapeXml(item.storeId)}"${preorder} stockCount="${item.stockCount}"/>`;
        })
        .join("\n");

      const priceXml =
        offer.price !== undefined
          ? `      <price>${offer.price}</price>`
          : [
              "      <cityprices>",
              ...(offer.cityPrices ?? []).map(
                (item) =>
                  `        <cityprice cityId="${escapeXml(item.cityId)}">${item.price}</cityprice>`,
              ),
              "      </cityprices>",
            ].join("\n");

      return [
        `    <offer sku="${escapeXml(offer.sku)}">`,
        `      <model>${escapeXml(offer.model)}</model>`,
        `      <brand>${escapeXml(offer.brand)}</brand>`,
        "      <availabilities>",
        availabilityXml,
        "      </availabilities>",
        priceXml,
        "    </offer>",
      ].join("\n");
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<kaspi_catalog date="${escapeXml(date)}"`,
    '  xmlns="kaspiShopping"',
    '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
    '  xsi:schemaLocation="kaspiShopping http://kaspi.kz/kaspishopping.xsd">',
    `  <company>${escapeXml(data.company)}</company>`,
    `  <merchantid>${escapeXml(data.merchantId)}</merchantid>`,
    "  <offers>",
    offers,
    "  </offers>",
    "</kaspi_catalog>",
    "",
  ].join("\n");
}
