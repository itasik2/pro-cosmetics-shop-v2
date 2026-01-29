// components/TrackProductView.tsx
"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";

export default function TrackProductView({
  productId,
  variantId,
}: {
  productId: string;
  variantId?: string | null;
}) {
  useEffect(() => {
    track("view_product", {
      productId,
      variantId: variantId ?? "base",
    });
  }, [productId, variantId]);

  return null;
}
