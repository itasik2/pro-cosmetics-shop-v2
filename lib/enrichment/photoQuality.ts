export function isUsablePhoto(value: unknown): value is string {
  const url = typeof value === "string" ? value.trim() : "";
  return Boolean(url) && !/^\/seed\//i.test(url) && isProductPhoto(url);
}

export function isProductPhoto(value: string) {
  // Some shops store actual product photos in /icons/. Inspect the file name,
  // not those directory names, while retaining the surrounding alt/class hints.
  const hint = value.toLowerCase().replace(/https?:\/\/[^\s"'<>]+/g, (raw) => {
    try {
      return new URL(raw).pathname.split("/").pop() || "";
    } catch {
      return raw;
    }
  });
  if (/\.(svg|gif)(?:$|[?#\s])/i.test(hint)) return false;
  return (
    !/(?:^|[^a-zа-я0-9])(?:logo|logotype|stub|placeholder|no[-_]?image|no[-_]?photo|default[-_]?image|loader|loading|spinner|sprite|favicon|avatar|banner|social|payment|captcha)(?:[^a-zа-я0-9]|$)/i.test(
      hint,
    ) &&
    !/(?:логотип|изображение отсутствует|нет фото|ajax[._-]?loader|sign-in|oauth)/iu.test(
      hint,
    )
  );
}

export type PhotoQuality = {
  width: number;
  height: number;
  sharpness?: number;
  version?: number;
};
type Photo = { url: string; source?: string; quality?: PhotoQuality };

export function photoQualityScore(photo: Photo) {
  const quality = photo.quality;
  if (quality && Number.isFinite(quality.width) && Number.isFinite(quality.height) &&
    quality.width > 0 && quality.height > 0) {
    const resolution = Math.min(1600, Math.sqrt(quality.width * quality.height));
    const sharpness = quality.sharpness;
    const detail = typeof sharpness === "number" && Number.isFinite(sharpness)
      ? 0.15 + 0.85 * Math.min(1, Math.max(0, sharpness) / 12)
      : 0.7;
    return resolution * detail;
  }
  // Legacy candidates still benefit from explicit resize/thumbnail URL hints.
  let url: URL;
  try { url = new URL(photo.url, "https://photo.invalid"); }
  catch { return 0; }
  const size = url.pathname.match(/(?:^|[^\d])(\d{2,5})[x_](\d{2,5})(?=[^\d]|$)/i);
  const width = Number(url.searchParams.get("width") || url.searchParams.get("w") || size?.[1]);
  const height = Number(url.searchParams.get("height") || url.searchParams.get("h") || size?.[2] || width);
  if (width > 0 && height > 0) return Math.min(1600, Math.sqrt(width * height)) * 0.7;
  return /(?:thumb(?:nail)?s?|small|mini|preview|resize_cache)(?:[\/_.-]|$)/i.test(url.pathname) ? 60 : 180;
}

export function rankPhotoCandidates<T extends Photo>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => photoQualityScore(b) - photoQualityScore(a) ||
    Number(a.source === "PRICE_LIST") - Number(b.source === "PRICE_LIST"));
}
