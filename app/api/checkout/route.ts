// app/api/checkout/route.ts
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { z } from "zod";
import { buildOrderFromCart, makeOrderNumber } from "@/lib/order";
import { prisma } from "@/lib/prisma";
import { notifyAdminNewOrder } from "@/lib/notify";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

const CheckoutSchema = z.object({
  customerName: z.string().min(2).max(80),
  phone: z.string().min(6).max(30),
  email: z.string().email().optional().or(z.literal("")),
  deliveryType: z.enum(["pickup", "delivery"]),
  address: z.string().max(250).optional().or(z.literal("")),
  comment: z.string().max(500).optional().or(z.literal("")),
  cart: z
    .array(
      z.object({
        id: z.string().min(1),
        qty: z.number().int().positive(),
      }),
    )
    .min(1),
});

function asArrayVariants(v: unknown): any[] {
  return Array.isArray(v) ? v : [];
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (ip) {
    const rl = checkRateLimit(`checkout:${ip}`, 8, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "too_many_requests", message: "Слишком много запросов. Попробуйте позже." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      );
    }
  }

  try {
    const json = await req.json().catch(() => ({}));
    const data = CheckoutSchema.parse(json);

    const address =
      data.deliveryType === "delivery" ? String(data.address || "").trim() : "";

    if (data.deliveryType === "delivery" && address.length < 5) {
      return NextResponse.json(
        { error: "validation_error", message: "Укажите адрес доставки" },
        { status: 400 },
      );
    }

    // Серверный пересчёт корзины (цены/qty/доступность)
    const built = await buildOrderFromCart(data.cart);
    if (built.error) {
      return NextResponse.json(
        { error: built.error, message: "Корзина пуста или товары недоступны" },
        { status: 400 },
      );
    }

    const orderNumber = makeOrderNumber();

    const created = await prisma.$transaction(async (tx) => {
      // Перечитать товары в рамках транзакции (для актуальных остатков)
      const productIds = Array.from(new Set(built.items.map((x) => x.productId)));

      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: {
          id: true,
          stock: true,
          variants: true,
        },
      });

      const map = new Map(products.map((p) => [p.id, p]));

      // 1) Проверка остатков
      for (const it of built.items) {
        const p = map.get(it.productId);
        if (!p) throw new Error("product_missing");

        if (!it.variantId) {
          if ((p.stock ?? 0) < it.qty) throw new Error("out_of_stock");
        } else {
          const variants = asArrayVariants(p.variants);
          const idx = variants.findIndex((v) => String(v?.id ?? "") === it.variantId);
          if (idx < 0) throw new Error("variant_missing");
          const vStock = Math.trunc(Number(variants[idx]?.stock) || 0);
          if (vStock < it.qty) throw new Error("out_of_stock");
        }
      }

      // 2) Списание остатков
      // base: атомарно decrement
      // variant: обновление JSON (MVP)
      for (const it of built.items) {
        const p = map.get(it.productId)!;

        if (!it.variantId) {
          await tx.product.update({
            where: { id: it.productId },
            data: { stock: { decrement: it.qty } },
          });
        } else {
          const variants = asArrayVariants(p.variants);
          const idx = variants.findIndex((v) => String(v?.id ?? "") === it.variantId);
          if (idx < 0) throw new Error("variant_missing");

          const current = variants[idx] ?? {};
          const nextStock = Math.trunc(Number(current.stock) || 0) - it.qty;

          const nextVariants = [...variants];
          nextVariants[idx] = { ...current, stock: nextStock };

          await tx.product.update({
            where: { id: it.productId },
            data: { variants: nextVariants as any },
          });

          // чтобы повторные списания в одной транзакции (если вдруг дубль) были консистентны
          map.set(it.productId, { ...p, variants: nextVariants } as any);
        }
      }

      // 3) Создание заказа
      const order = await tx.order.create({
        data: {
          orderNumber,
          customerName: data.customerName.trim(),
          phone: data.phone.trim(),
          email: data.email ? String(data.email).trim() : null,
          deliveryType: data.deliveryType,
          address: address || null,
          comment: data.comment ? String(data.comment).trim() : null,
          currency: "KZT",
          totalAmount: built.total,
          status: "NEW",
          items: {
            create: built.items.map((it) => ({
              productId: it.productId,
              variantId: it.variantId,
              title: it.title,
              unitPrice: it.unitPrice,
              qty: it.qty,
              lineTotal: it.lineTotal,
              image: it.image ?? null,
              sku: it.sku ?? null,
            })),
          },
        },
        select: { id: true, orderNumber: true, totalAmount: true },
      });

      return order;
    });

    // уведомление админу (после успешной транзакции)
    await notifyAdminNewOrder({
      orderNumber: created.orderNumber,
      totalAmount: created.totalAmount,
      customerName: data.customerName,
      phone: data.phone,
      deliveryType: data.deliveryType,
      address: address || null,
    });

    return NextResponse.json(
      { ok: true, orderId: created.id, orderNumber: created.orderNumber },
      { status: 200 },
    );
  } catch (e: any) {
    if (e?.name === "ZodError") {
      return NextResponse.json(
        { error: "validation_error", issues: e.issues },
        { status: 400 },
      );
    }

    const msg = String(e?.message || "");
    if (msg === "out_of_stock") {
      return NextResponse.json(
        { error: "out_of_stock", message: "Не хватает товара на складе. Обновите корзину." },
        { status: 409 },
      );
    }
    if (msg === "variant_missing" || msg === "product_missing") {
      return NextResponse.json(
        { error: "not_available", message: "Часть товаров недоступна. Обновите корзину." },
        { status: 409 },
      );
    }

    console.error("CHECKOUT CREATE ORDER ERROR:", msg || e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
