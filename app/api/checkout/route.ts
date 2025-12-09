// app/api/checkout/session/route.ts
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getStripe } from "@/lib/stripe";

// Валюта — из ENV, по умолчанию USD.
// Используйте "kzt" только если она включена на вашем аккаунте Stripe.
const CURRENCY = (process.env.NEXT_PUBLIC_CURRENCY || "usd").toLowerCase();

function getBaseUrl() {
  // Предпочитаем явный публичный URL
  const envUrl = process.env.NEXT_PUBLIC_URL?.replace(/\/$/, "");
  if (envUrl) return envUrl;
  // Фолбэк: собираем из заголовков запроса
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

const ItemsSchema = z.object({
  items: z.array(
    z.object({
      name: z.string().min(1),
      price: z.number().positive(),     // В МАЖОРНЫХ единицах (например, 1999.99 тенге)
      quantity: z.number().int().positive()
    })
  ).min(1)
});

export async function POST(req: Request) {
  try {
    const stripe = getStripe();
    if (!stripe) {
      return NextResponse.json({ error: "stripe_not_configured" }, { status: 500 });
    }

    const json = await req.json().catch(() => ({}));
    const { items } = ItemsSchema.parse(json);

    const base = getBaseUrl();
    const successUrl = `${base}/checkout/success`;
    const cancelUrl  = `${base}/checkout/cancel`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      // позволить купоны/промокоды при необходимости:
      // allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url: cancelUrl,
      payment_method_types: ["card"],
      line_items: items.map((i) => ({
        price_data: {
          currency: CURRENCY, // "usd" / "eur" / "kzt" (если включена в аккаунте)
          product_data: { name: i.name },
          // Stripe требует целые минорные единицы:
          // USD/KZT → cents/tiyn: умножаем на 100 и округляем
          unit_amount: Math.round(i.price * 100),
        },
        quantity: i.quantity,
      })),
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (e: any) {
    // Ошибка валидации входных данных
    if (e?.name === "ZodError") {
      return NextResponse.json({ error: "validation_error", issues: e.issues }, { status: 400 });
    }
    // Проброс ошибки Stripe с кодом — полезно для логов
    const code = e?.raw?.code || e?.code;
    console.error("CHECKOUT SESSION ERROR:", code || e?.message || e);
    return NextResponse.json({ error: "stripe_failed", code }, { status: 500 });
  }
}
