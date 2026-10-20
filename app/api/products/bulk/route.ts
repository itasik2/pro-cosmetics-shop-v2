import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import {
  applyProductActions,
  productActionSchema,
} from "@/lib/adminProductActions";

export const runtime = "nodejs";
export const revalidate = 0;
export const maxDuration = 60;

export async function POST(req: Request) {
  const forbidden = await requireAdmin();
  if (forbidden) return forbidden;
  const parsed = productActionSchema.safeParse(
    await req.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "validation",
        message: "Выберите от 1 до 100 товаров и действие.",
      },
      { status: 400 },
    );
  return NextResponse.json(await applyProductActions(parsed.data));
}
