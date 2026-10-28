"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { observeListEnd } from "@/lib/progressiveList";

export default function useProgressiveList<T>(items: readonly T[], batchSize: number, resetKey: string) {
  const [state, setState] = useState({ key: resetKey, limit: batchSize });
  // Reset before committing a different search/filter result, preserving loaded rows on edits.
  if (state.key !== resetKey) setState({ key: resetKey, limit: batchSize });
  const limit = state.key === resetKey ? state.limit : batchSize;
  const count = Math.min(limit, items.length);
  const hasMore = count < items.length;
  const endRef = useRef<HTMLDivElement>(null);
  const visibleItems = useMemo(() => items.slice(0, count), [items, count]);
  const revealNext = useCallback(() => setState((current) => ({ key: resetKey,
    limit: Math.min(items.length, (current.key === resetKey ? current.limit : batchSize) + batchSize),
  })), [resetKey, items.length, batchSize]);
  const revealAll = useCallback(() => setState({ key: resetKey, limit: items.length }), [resetKey, items.length]);

  useEffect(() => {
    if (!hasMore || !endRef.current) return;
    return observeListEnd(endRef.current, revealNext, revealAll);
  }, [hasMore, count, resetKey, revealNext, revealAll]);

  return { items: visibleItems, count, total: items.length, hasMore, endRef, revealAll };
}
