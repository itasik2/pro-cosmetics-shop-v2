export type PreparedProposalPhotos = Record<string, unknown> & {
  photoAutomation?: { incomplete?: boolean; attempts?: unknown[] };
};

/** Each response persists a small batch. Continue until every SKU was checked. */
export async function prepareProposalPhotoBatches(
  proposalId: string,
  options: { resume?: boolean; signal?: AbortSignal; onBatch?: (photos: PreparedProposalPhotos) => void } = {},
  request: typeof fetch = fetch,
) {
  let previous = "";
  for (let batch = 0; batch < 100; batch++) {
    const response = await request(`/api/admin/enrichment/proposals/${encodeURIComponent(proposalId)}/photos`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume: batch > 0 || options.resume !== false }), signal: options.signal,
    });
    const photos = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(photos.message || "Не удалось завершить подбор фото. Обновите карточку или повторите подбор.");
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    options.onBatch?.(photos);
    if (!photos.photoAutomation?.incomplete) return photos as PreparedProposalPhotos;
    const progress = JSON.stringify(photos.photoAutomation.attempts || []);
    if (progress === previous) break;
    previous = progress;
  }
  throw new Error("Часть вариантов ещё не проверена. Повторите подбор фото.");
}
