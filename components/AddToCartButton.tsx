"use client";

import { useEffect, useState } from "react";
import { getQty, setQty } from "@/lib/cartStorage";
import { useRouter } from "next/navigation";


type Props = {
  productId: string;
  disabled?: boolean;
  addQty?: number; // сколько добавить за раз (по умолчанию 1)
  maxStock?: number; // ограничение по складу
  goToCartOnClick?: boolean;
};

export default function AddToCartButton({
  productId,
  disabled,
  addQty,
  maxStock,
}: Props) {
  const [qty, setQtyState] = useState(0);
  const router = useRouter();
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

    const handleClick = () => {
    // если товар уже в корзине → просто открыть корзину
    if (qty > 0 && goToCartOnClick) {
      router.push("/checkout");
      return;
    }
  
    // обычное добавление
    const step = Math.max(1, addQty ?? 1);
    const next = setQty(productId, qty + step, maxStock);
    setQtyState(next);
  };


  const btnClass =
    "btn text-xs px-3 py-2 rounded-xl " +
    (disabled ? "opacity-50 cursor-not-allowed" : "");

  const label = disabled ? "Нет в наличии" : qty > 0 ? "В корзине" : "Купить";

  return (
    <button
  type="button"
  className={btnClass}
  onClick={handleClick}
  disabled={!!disabled || (typeof maxStock === "number" && maxStock <= 0)}
>
  {label}
</button>
  );
}
