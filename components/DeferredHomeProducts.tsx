"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ProductCardProps } from "./ProductCard";
import { observeListEnd } from "@/lib/progressiveList";

type InteractiveCard = typeof import("./ProductCard").default;

export default function DeferredHomeProducts({ products, fallback }: {
  products: ProductCardProps["product"][];
  fallback: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [Card, setCard] = useState<InteractiveCard | null>(null);

  useEffect(() => {
    const target = container.current;
    if (!target) return;

    let current = true;
    const load = () => {
      void import("./ProductCard")
        .then(({ default: ProductCard }) => {
          if (current) setCard(() => ProductCard);
        })
        .catch(() => { /* Keep the linked server cards if the chunk is unavailable. */ });
    };
    const stopObserving = observeListEnd(target, load, load, 200);

    return () => {
      current = false;
      stopObserving();
    };
  }, []);

  return (
    <div ref={container} className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
      {Card ? products.map((product) => <Card key={product.id} product={product} />) : fallback}
    </div>
  );
}
