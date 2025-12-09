// app/api/checkout/route.ts
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getStripe } from "@/lib/stripe";

const CURRENCY = (process.env.NEXT_PUBLIC_CURRENCY || "usd").toLowerCase();

function getBaseUrl() {
  const envUrl = process.env.NEXT_PUBLIC_URL?.replace(/\/$/, "");
  if (envUrl) return envUrl;
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

const ItemsSchema = z.object({
  items: z.array(
    z.object({
      name: z.string().min(1),
      // ожидание: цена в МАЖОРНЫХ единицах (тенге, доллары) — не в тиынах/центах
      price: z.number().positive(),
      quantity: z.number().int().positive(),
    })
  ).min(1),
});

export async function POST(req: Request) {
  try {
    const stripe = getStripe();
    if (!stripe) return NextResponse.json({ error: "stripe_not_configured" }, { status: 500 });

    const json = await req.json().catch(() => ({}));
    const { items } = ItemsSchema.parse(json);

    const base = getBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: `${base}/checkout/success`,
      cancel_url: `${base}/checkout/cancel`,
      payment_method_types: ["card"],
      line_items: items.map((i) => ({
        price_data: {
          currency: CURRENCY,               // "usd" / "eur" / "kzt" (если включена у вас в Stripe)
          product_data: { name: i.name },
          unit_amount: Math.round(i.price * 100), // Stripe ждёт МИНОРНЫЕ единицы
        },
        quantity: i.quantity,
      })),
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (e: any) {
    if (e?.name === "ZodError") {
      return NextResponse.json({ error: "validation_error", issues: e.issues }, { status: 400 });
    }
    const code = e?.raw?.code || e?.code;
    console.error("CHECKOUT ERROR:", code || e?.message || e);
    return NextResponse.json({ error: "stripe_failed", code }, { status: 500 });
  }
}
