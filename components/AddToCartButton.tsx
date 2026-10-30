"use client";

import { useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { getQty, setQty, makeCartKey } from "@/lib/cartStorage";
import { cardCartQty, subscribeCardCart } from "@/lib/catalogCardStorage";
import { track } from "@/lib/analytics";

type Props = {
  productId: string;
  variantId?: string | null;
  disabled?: boolean;
  maxStock?: number;
};

export default function AddToCartButton({
  productId,
  variantId,
  disabled,
  maxStock,
}: Props) {
  const router = useRouter();
  const cartKey = makeCartKey(productId, variantId);
  const qty = useSyncExternalStore(subscribeCardCart, () => cardCartQty(cartKey), () => 0);

  const canBuy = !disabled && !(typeof maxStock === "number" && maxStock <= 0);

  const addOne = () => {
    if (!canBuy) return;

    // analytics
    track("add_to_cart", {
      productId,
      variantId: variantId ?? "base",
    });

    setQty(cartKey, getQty(cartKey) + 1, maxStock);
  };

  const decOne = () => {
    // analytics (опционально)
    track("remove_from_cart", {
      productId,
      variantId: variantId ?? "base",
    });

    setQty(cartKey, getQty(cartKey) - 1, maxStock);
  };

  const openCart = () => router.push("/checkout");

  if (qty <= 0) {
    return (
      <button
        type="button"
        className={
          "btn h-8 min-h-8 w-[124px] shrink-0 rounded-full px-3 py-1 text-xs " +
          (canBuy ? "" : "opacity-50 cursor-not-allowed")
        }
        onClick={addOne}
        disabled={!canBuy}
      >
        {canBuy ? "Купить" : "Нет в наличии"}
      </button>
    );
  }

  const plusDisabled =
    !canBuy || (typeof maxStock === "number" && qty >= maxStock);

  return (
    <div className="inline-flex h-8 w-[124px] shrink-0 items-stretch overflow-hidden rounded-full border bg-white">
      <button
        type="button"
        className="flex w-8 shrink-0 items-center justify-center text-sm hover:bg-gray-50"
        onClick={decOne}
        aria-label="Уменьшить количество"
      >
        −
      </button>

      <button
        type="button"
        className="flex min-w-0 flex-1 items-center justify-center text-center text-sm font-semibold hover:bg-gray-50"
        onClick={openCart}
        aria-label="Открыть корзину"
        title="Открыть корзину"
      >
        {qty}
      </button>

      <button
        type="button"
        className="flex w-8 shrink-0 items-center justify-center text-sm hover:bg-gray-50 disabled:opacity-50"
        onClick={addOne}
        disabled={plusDisabled}
        aria-label="Увеличить количество"
      >
        +
      </button>
    </div>
  );
}
