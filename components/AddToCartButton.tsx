"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Props = {
  productId: string;
  disabled?: boolean;
};

type CartItem = { id: string; qty: number };

function readCart(): CartItem[] {
  try {
    const raw = localStorage.getItem("cart");
    const arr = raw ? (JSON.parse(raw) as CartItem[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeCart(items: CartItem[]) {
  localStorage.setItem("cart", JSON.stringify(items));
  window.dispatchEvent(new Event("storage-sync"));
}

export default function AddToCartButton({ productId, disabled }: Props) {
  const [qty, setQty] = useState(0);

  const sync = () => {
    const cart = readCart();
    const found = cart.find((x) => x.id === productId);
    setQty(found?.qty ?? 0);
  };

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

  const add = () => {
    const cart = readCart();
    const idx = cart.findIndex((x) => x.id === productId);
    if (idx >= 0) cart[idx] = { id: productId, qty: cart[idx].qty + 1 };
    else cart.push({ id: productId, qty: 1 });
    writeCart(cart);
    sync();
  };

  const btnClass =
    "btn text-xs px-3 py-2 rounded-xl " +
    (disabled
      ? "opacity-50 cursor-not-allowed"
      : "");

  if (qty > 0) {
    return (
      <Link href="/checkout" className="btn text-xs">
        В корзине ({qty})
      </Link>
    );
  }

  return (
    <button type="button" className={btnClass} onClick={add} disabled={disabled}>
      {disabled ? "Нет в наличии" : "Купить"}
    </button>
  );
}
