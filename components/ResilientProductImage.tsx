"use client";

import { useEffect, useRef, useState } from "react";
import { productThumbnail } from "@/lib/productThumbnails";
import type { CatalogImageSources } from "@/lib/catalogTypes";

const WIDTHS = [320, 480, 640, 768, 960];

type Props = {
  src: string;
  product: CatalogImageSources;
  alt: string;
  sizes?: string;
  priority?: boolean;
  fullSize?: boolean;
};

function fallbackImageUrl(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      url.hostname !== "res.cloudinary.com" ? url.href : null;
  } catch {
    return null;
  }
}

export default function ResilientProductImage({
  src, product, alt, sizes, priority = false, fullSize = false,
}: Props) {
  const exactSource = fallbackImageUrl(product.images?.find((image) => image.url === src)?.sourceUrl);
  const commonImage = fallbackImageUrl(product.image);
  const commonSource = fallbackImageUrl(product.imageSourceUrl);
  const fallbacks = [...new Set([exactSource, commonImage, commonSource])]
    .filter((url): url is string => Boolean(url && url !== src));
  const [fallbackIndex, setFallbackIndex] = useState(-1);
  const activeSrc = fallbacks[fallbackIndex] ?? src;
  const preferred = fullSize ? activeSrc : productThumbnail(activeSrc, 640);
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const retryTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setAttempt(0);
    setWaiting(false);
    setFailed(false);
    setFallbackIndex(-1);
    return () => {
      if (retryTimeout.current) clearTimeout(retryTimeout.current);
      retryTimeout.current = null;
    };
  }, [src, exactSource, commonImage, commonSource, fullSize]);

  const currentSrc = attempt === 0
    ? preferred
    : attempt === 1 && preferred !== activeSrc
      ? activeSrc
      : `${activeSrc}${activeSrc.includes("?") ? "&" : "?"}retry=${attempt}`;

  // The fallback always uses the known source, not another unprepared derivative.
  const currentSrcSet = attempt === 0 && !fullSize && preferred !== activeSrc
    ? WIDTHS.map((width) => `${productThumbnail(activeSrc, width)} ${width}w`).join(", ")
    : undefined;

  function handleError() {
    // A suspended Cloudinary account cannot serve the original OR derivative:
    // fall back to the saved supplier URL without waiting through retries.
    if (fallbackIndex + 1 < fallbacks.length) {
      setFallbackIndex(fallbackIndex + 1);
      setAttempt(0);
      setWaiting(false);
      return;
    }
    if (attempt === 0 && preferred !== activeSrc) {
      setAttempt(1);
      return;
    }
    if (attempt >= 3) {
      setFailed(true);
      return;
    }
    setWaiting(true);
    retryTimeout.current = setTimeout(() => {
      setAttempt((value) => value + 1);
      setWaiting(false);
    }, attempt === 0 ? 1200 : 2800);
  }

  if (waiting || failed) {
    return (
      <div role="status" className="flex h-full w-full items-center justify-center bg-gray-50 px-4 text-center text-xs text-gray-500">
        {failed ? "Фото временно недоступно" : "Загружаем фото…"}
      </div>
    );
  }

  return (
    <img
      src={currentSrc}
      srcSet={currentSrcSet}
      sizes={sizes}
      alt={alt}
      width={640}
      height={640}
      className="h-full w-full object-contain"
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      onError={handleError}
    />
  );
}
