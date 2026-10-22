"use client";

import { useEffect, useRef, useState } from "react";
import { pendingPhotoTargets, type PhotoSearchProduct } from "@/lib/enrichment/photoAutomation";
import { prepareProposalPhotoBatches, type PreparedProposalPhotos } from "@/lib/enrichment/preparePhotosClient";

// Two visible cards at most; each server request searches at most two SKUs.
let active = 0;
const queue: (() => void)[] = [];
async function scheduled<T>(signal: AbortSignal, action: () => Promise<T>) {
  if (active >= 2) await new Promise<void>((resolve) => queue.push(resolve));
  else active++;
  try {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    return await action();
  } finally {
    const next = queue.shift();
    if (next) next();
    else active--;
  }
}

export default function AutomaticProposalPhotos({ proposalId, product, facts, disabled, onPrepared, onBusyChange }: {
  proposalId: string;
  product: PhotoSearchProduct;
  facts: unknown;
  disabled?: boolean;
  onPrepared: (photos: PreparedProposalPhotos) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const latest = useRef({ product, facts, onPrepared, onBusyChange });
  const completed = useRef("");
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState("");
  const identity = JSON.stringify(product);

  useEffect(() => { latest.current = { product, facts, onPrepared, onBusyChange }; });
  useEffect(() => {
    if (!element.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "200px" });
    observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const key = proposalId + identity;
    if (!visible || disabled || completed.current === key || !pendingPhotoTargets(latest.current.product, latest.current.facts).length) return;
    const controller = new AbortController();
    const busyChange = latest.current.onBusyChange;
    busyChange(true);
    setMessage("Фото вариантов подбираются автоматически по SKU…");
    void scheduled(controller.signal, () => prepareProposalPhotoBatches(proposalId, {
      signal: controller.signal,
      onBatch: (photos) => { if (!controller.signal.aborted) latest.current.onPrepared(photos); },
    })).then(() => {
      if (controller.signal.aborted) return;
      completed.current = key;
      setMessage("Фото вариантов проверены. Найденные снимки подставлены; без отдельного фото используется общее.");
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      completed.current = key;
      setMessage(error instanceof Error ? error.message : "Подбор фото не завершён. Повторите подбор.");
    }).finally(() => { if (!controller.signal.aborted) busyChange(false); });
    return () => { controller.abort(); busyChange(false); };
  }, [proposalId, identity, visible, disabled]);

  return <div ref={element} role="status" aria-live="polite" className="min-h-px text-xs text-gray-600">{message}</div>;
}
