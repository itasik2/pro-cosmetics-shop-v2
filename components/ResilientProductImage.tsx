"use client";

import { useEffect, useRef, useState } from "react";
import { productThumbnail } from "@/lib/productThumbnails";

const WIDTHS = [320, 480, 640, 768, 960];

type Props = {
  src: string;
  alt: string;
  sizes?: string;
  priority?: boolean;
  fullSize?: boolean;
};

/** Reuse ready images and recover when a Cloudinary derivative temporarily returns HTTP 423. */
export default function ResilientProductImage({
  src, alt, sizes, priority = false, fullSize = false,
}: Props) {
  const preferred = fullSize ? src : productThumbnail(src, 640);
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  const retryTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setAttempt(0);
    setWaiting(false);
    setFailed(false);
    return () => {
      if (retryTimeout.current) clearTimeout(retryTimeout.current);
      retryTimeout.current = null;
    };
  }, [src, fullSize]);

  const currentSrc = attempt === 0
    ? preferred
    : attempt === 1 && preferred !== src
      ? src
      : `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}`;

  // The fallback always uses the known source, not another unprepared derivative.
  const currentSrcSet = attempt === 0 && !fullSize && preferred !== src
    ? WIDTHS.map((width) => `${productThumbnail(src, width)} ${width}w`).join(", ")
    : undefined;

  function handleError() {
    if (attempt === 0 && preferred !== src) {
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
