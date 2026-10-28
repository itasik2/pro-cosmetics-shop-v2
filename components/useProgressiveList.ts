"use client";

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observeListEnd } from "@/lib/progressiveList";

export default function useProgressiveList<T>(items: readonly T[], batchSize: number, resetKey: string, initialSize = batchSize) {
  const [state, setState] = useState(() => ({ key: resetKey, limit: initialSize }));
  // Reset before committing a different search/filter result, preserving loaded rows on edits.
  if (state.key !== resetKey) setState({ key: resetKey, limit: initialSize });
  const limit = state.key === resetKey ? state.limit : initialSize;
  const count = Math.min(limit, items.length);
  const hasMore = count < items.length;
  const endRef = useRef<HTMLDivElement>(null);
  const visibleItems = useMemo(() => items.slice(0, count), [items, count]);
  const revealNext = useCallback(() => startTransition(() => setState((current) => ({ key: resetKey,
    limit: Math.min(items.length, (current.key === resetKey ? current.limit : initialSize) + batchSize),
  }))), [resetKey, items.length, batchSize, initialSize]);
  const revealAll = useCallback(() => setState({ key: resetKey, limit: items.length }), [resetKey, items.length]);

  useEffect(() => {
    if (!hasMore || !endRef.current) return;
    return observeListEnd(endRef.current, revealNext, revealAll);
  }, [hasMore, count, resetKey, revealNext, revealAll]);

  return { items: visibleItems, count, total: items.length, hasMore, endRef, revealAll };
}
