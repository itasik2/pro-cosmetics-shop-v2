"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getQty, setQty } from "@/lib/cartStorage";

type Props = {
  productId: string;
  disabled?: boolean;
  maxStock?: number; // stock товара
};

export default function AddToCartButton({ productId, disabled, maxStock }: Props) {
  const router = useRouter();
  const [qty, setQtyState] = useState(0);

  const sync = () => setQtyState(getQty(productId));

  useEffect(() => {
    sync();
    const onSync = () => sync();
    window.addEventListener("storage", onSync);
    window.addEventListener("storage-sync", onSync);
    return () => {
      window.removeEventListener("storage", onSync);
      window.removeEventListener("storage-sync", onSync);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const canBuy = !disabled && !(typeof maxStock === "number" && maxStock <= 0);

  const addOne = () => {
    if (!canBuy) return;
    const next = setQty(productId, qty + 1, maxStock);
    setQtyState(next);
  };

  const decOne = () => {
    const next = setQty(productId, qty - 1, maxStock);
    setQtyState(next);
  };

  const openCart = () => router.push("/checkout");

  // Состояние "Купить"
  if (qty <= 0) {
    return (
      <button
        type="button"
        className={
          "btn text-xs px-3 py-2 rounded-xl " +
          (canBuy ? "" : "opacity-50 cursor-not-allowed")
        }
        onClick={addOne}
        disabled={!canBuy}
      >
        {canBuy ? "Купить" : "Нет в наличии"}
      </button>
    );
  }

  // Состояние степпера внутри одной кнопки
  const plusDisabled = !canBuy || (typeof maxStock === "number" && qty >= maxStock);

  return (
    <div className="inline-flex items-stretch rounded-xl border bg-white overflow-hidden">
      <button
        type="button"
        className="px-3 text-sm hover:bg-gray-50"
        onClick={decOne}
        aria-label="Уменьшить количество"
      >
        −
      </button>

      <button
        type="button"
        className="px-3 min-w-[56px] text-center hover:bg-gray-50"
        onClick={openCart}
        aria-label="Открыть корзину"
        title="Открыть корзину"
      >
        <div className="text-sm font-semibold leading-4">{qty}</div>
        <div className="text-[10px] text-gray-500 leading-3">В корзине</div>
      </button>

      <button
        type="button"
        className="px-3 text-sm hover:bg-gray-50 disabled:opacity-50"
        onClick={addOne}
        disabled={plusDisabled}
        aria-label="Увеличить количество"
      >
        +
      </button>
    </div>
  );
}
