// app/api/checkout/route.ts
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { z } from "zod";
import { buildOrderFromCart, makeOrderNumber } from "@/lib/order";
import { prisma } from "@/lib/prisma";
import { notifyAdminNewOrder } from "@/lib/notify";

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

export async function POST(req: Request) {
  try {
    const json = await req.json().catch(() => ({}));
    const data = CheckoutSchema.parse(json);

    // address обязателен только для delivery
    const address =
      data.deliveryType === "delivery" ? String(data.address || "").trim() : "";

    if (data.deliveryType === "delivery" && address.length < 5) {
      return NextResponse.json(
        { error: "validation_error", message: "Укажите адрес доставки" },
        { status: 400 },
      );
    }

    // Серверный пересчет корзины
    const built = await buildOrderFromCart(data.cart);
    if (built.error) {
      return NextResponse.json(
        { error: built.error, message: "Корзина пуста или товары недоступны" },
        { status: 400 },
      );
    }

    // Генерируем номер
    const orderNumber = makeOrderNumber();

    const order = await prisma.order.create({
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

    // уведомление админу (если настроено)
    await notifyAdminNewOrder({
      orderNumber: order.orderNumber,
      totalAmount: order.totalAmount,
      customerName: data.customerName,
      phone: data.phone,
      deliveryType: data.deliveryType,
      address: address || null,
    });

    return NextResponse.json(
      { ok: true, orderId: order.id, orderNumber: order.orderNumber },
      { status: 200 },
    );
  } catch (e: any) {
    if (e?.name === "ZodError") {
      return NextResponse.json(
        { error: "validation_error", issues: e.issues },
        { status: 400 },
      );
    }
    console.error("CHECKOUT CREATE ORDER ERROR:", e?.message || e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
