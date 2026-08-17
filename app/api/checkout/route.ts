// app/api/checkout/route.ts
export const runtime = "nodejs";
export const revalidate = 0;

import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { buildOrderFromCart, makeOrderNumber } from "@/lib/order";
import {
  recordCustomerNotificationResult,
  recordOrderNotificationResult,
} from "@/lib/orderNotifications";
import { prisma } from "@/lib/prisma";
import { notifyAdminNewOrder, notifyCustomerOrderCreated } from "@/lib/notify";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { createOrderAccessToken, orderAccessUrl } from "@/lib/orderAccess";

const CheckoutSchema = z.object({
  customerName: z.string().min(2).max(80),
  phone: z.string().min(6).max(30),
  email: z.string().email(),
  deliveryType: z.enum(["pickup", "delivery"]),
  address: z.string().max(250).optional().or(z.literal("")),
  comment: z.string().max(500).optional().or(z.literal("")),
  paymentMethod: z.enum(["CASH", "KASPI_TRANSFER"]).default("KASPI_TRANSFER"),
  cart: z
    .array(
      z.object({
        id: z.string().min(1),
        qty: z.number().int().positive(),
      }),
    )
    .min(1),
});

function asArrayVariants(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object",
      )
    : [];
}

export async function POST(req: Request) {
  const ip = getClientIp(req);
  if (ip) {
    const rateLimit = checkRateLimit(`checkout:${ip}`, 8, 60_000);
    if (!rateLimit.ok) {
      return NextResponse.json(
        {
          error: "too_many_requests",
          message: "Слишком много запросов. Попробуйте позже.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSec) },
        },
      );
    }
  }

  try {
    const data = CheckoutSchema.parse(await req.json().catch(() => ({})));
    const address =
      data.deliveryType === "delivery" ? String(data.address || "").trim() : "";

    if (data.deliveryType === "delivery" && address.length < 5) {
      return NextResponse.json(
        { error: "validation_error", message: "Укажите адрес доставки" },
        { status: 400 },
      );
    }

    const built = await buildOrderFromCart(data.cart);
    if (built.error) {
      return NextResponse.json(
        {
          error: built.error,
          message: "Корзина пуста или товары недоступны",
        },
        { status: 400 },
      );
    }

    const orderNumber = makeOrderNumber();
    const access = createOrderAccessToken();
    const created = await prisma.$transaction(async (tx) => {
      const productIds = Array.from(
        new Set(built.items.map((item) => item.productId)),
      );

      const products = await tx.product.findMany({
        where: {
          id: { in: productIds },
          isPublished: true,
        },
        select: {
          id: true,
          stock: true,
          variants: true,
        },
      });

      const productMap = new Map(
        products.map((product) => [product.id, product]),
      );

      for (const item of built.items) {
        const product = productMap.get(item.productId);
        if (!product) throw new Error("product_missing");

        if (!item.variantId) {
          if (product.stock < item.qty) throw new Error("out_of_stock");
          continue;
        }

        const variants = asArrayVariants(product.variants);
        const variant = variants.find(
          (row) => String(row.id ?? "") === item.variantId,
        );
        if (!variant) throw new Error("variant_missing");

        const variantStock = Math.trunc(Number(variant.stock) || 0);
        if (variantStock < item.qty) throw new Error("out_of_stock");
      }

      for (const item of built.items) {
        const product = productMap.get(item.productId);
        if (!product) throw new Error("product_missing");

        if (!item.variantId) {
          await tx.product.update({
            where: { id: item.productId },
            data: { stock: { decrement: item.qty } },
          });
          continue;
        }

        const variants = asArrayVariants(product.variants);
        const index = variants.findIndex(
          (row) => String(row.id ?? "") === item.variantId,
        );
        if (index < 0) throw new Error("variant_missing");

        const current = variants[index] || {};
        const nextStock = Math.trunc(Number(current.stock) || 0) - item.qty;
        const nextVariants = [...variants];
        nextVariants[index] = { ...current, stock: nextStock };

        await tx.product.update({
          where: { id: item.productId },
          data: {
            variants: nextVariants as unknown as Prisma.InputJsonValue,
          },
        });

        productMap.set(item.productId, {
          ...product,
          variants: nextVariants as unknown as Prisma.JsonValue,
        });
      }

      return tx.order.create({
        data: {
          orderNumber,
          customerName: data.customerName.trim(),
          phone: data.phone.trim(),
          email: data.email.trim(),
          deliveryType: data.deliveryType,
          address: address || null,
          comment: data.comment ? data.comment.trim() : null,
          currency: "KZT",
          totalAmount: built.total,
          status: "NEW",
          paymentMethod: data.paymentMethod,
          paymentStatus: data.paymentMethod === "CASH" ? "DUE_ON_DELIVERY" : "UNPAID",
          customerAccessTokenHash: access.tokenHash,
          customerNotificationStatus: "PENDING",
          items: {
            create: built.items.map((item) => ({
              productId: item.productId,
              variantId: item.variantId,
              title: item.title,
              unitPrice: item.unitPrice,
              qty: item.qty,
              lineTotal: item.lineTotal,
              image: item.image ?? null,
              sku: item.sku ?? null,
            })),
          },
        },
        select: { id: true, orderNumber: true, totalAmount: true },
      });
    });

    const notificationArgs = {
      orderId: created.id,
      orderNumber: created.orderNumber,
      totalAmount: created.totalAmount,
      customerName: data.customerName,
      phone: data.phone,
      customerEmail: data.email.trim(),
      orderAccessUrl: orderAccessUrl(access.token),
      deliveryType: data.deliveryType,
      address: address || null,
      comment: data.comment ? data.comment.trim() : null,
      paymentMethod: data.paymentMethod,
      items: built.items.map((item) => ({
        title: item.title,
        qty: item.qty,
        lineTotal: item.lineTotal,
        sku: item.sku,
      })),
    };

    const notification = await notifyAdminNewOrder(notificationArgs);
    await recordOrderNotificationResult(created.id, notification);

    if (data.email) {
      const customerNotification = await notifyCustomerOrderCreated(notificationArgs);
      await recordCustomerNotificationResult(created.id, customerNotification);
    }

    return NextResponse.json(
      {
        ok: true,
        orderId: created.id,
        orderNumber: created.orderNumber,
        accessToken: access.token,
        accessUrl: orderAccessUrl(access.token),
      },
      { status: 200 },
    );
  } catch (error: any) {
    if (error?.name === "ZodError") {
      return NextResponse.json(
        { error: "validation_error", issues: error.issues },
        { status: 400 },
      );
    }

    const message = String(error?.message || "");
    if (message === "out_of_stock") {
      return NextResponse.json(
        {
          error: "out_of_stock",
          message: "Не хватает товара на складе. Обновите корзину.",
        },
        { status: 409 },
      );
    }
    if (message === "variant_missing" || message === "product_missing") {
      return NextResponse.json(
        {
          error: "not_available",
          message: "Часть товаров недоступна. Обновите корзину.",
        },
        { status: 409 },
      );
    }

    console.error("CHECKOUT CREATE ORDER ERROR:", message || error);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
