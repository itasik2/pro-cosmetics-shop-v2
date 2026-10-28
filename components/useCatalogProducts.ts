"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { mergeCatalogProducts, requestCatalogBatch } from "@/lib/catalogClient";
import { observeListEnd } from "@/lib/progressiveList";
import type { CatalogBatch, CatalogSource } from "@/lib/catalogTypes";

export default function useCatalogProducts(initial: CatalogBatch, source: CatalogSource, favorites: string[], needsInitial: boolean) {
  const [state, setState] = useState(() => ({
    ...initial, ...(needsInitial ? { products: [], total: 0, cursor: undefined, hasMore: true } : {}),
    loading: needsInitial, error: "",
  }));
  const snapshot = useRef(state);
  const activeRequest = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [loadAll, setLoadAll] = useState(false);
  useEffect(() => { snapshot.current = state; }, [state]);

  const loadNext = useCallback(async () => {
    if (activeRequest.current && !activeRequest.current.signal.aborted) return;
    const current = snapshot.current;
    if (!current.hasMore) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 15000);
    setState((value) => ({ ...value, loading: true, error: "" }));
    try {
      const batch = await requestCatalogBatch({ source, favorites, cursor: current.cursor }, controller.signal);
      if (controller.signal.aborted) return;
      startTransition(() => setState((value) => ({ ...batch,
        products: mergeCatalogProducts(value.products, batch.products),
        loading: false, error: "",
      })));
    } catch {
      if (!controller.signal.aborted || timedOut) setState((value) => ({ ...value, loading: false, error: "Не удалось загрузить товары. Попробуйте ещё раз." }));
    } finally {
      clearTimeout(timeout);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        if (controller.signal.aborted) setState((value) => ({ ...value, loading: false }));
      }
    }
  }, [source, favorites]);

  useEffect(() => () => activeRequest.current?.abort(), []);
  useEffect(() => {
    if (needsInitial && !snapshot.current.products.length && !snapshot.current.error) void loadNext();
  }, [needsInitial, loadNext]);
  useEffect(() => {
    if (loadAll && state.hasMore && !state.loading && !state.error) void loadNext();
  }, [loadAll, state.hasMore, state.loading, state.error, state.cursor?.id, loadNext]);
  const revealAll = useCallback(() => setLoadAll(true), []);
  useEffect(() => {
    if (!state.hasMore || state.loading || state.error || loadAll || !endRef.current) return;
    return observeListEnd(endRef.current, () => void loadNext(), revealAll, 400);
  }, [state.hasMore, state.loading, state.error, state.cursor?.id, loadAll, loadNext, revealAll]);

  return { ...state, endRef, revealAll, retry: loadNext };
}
