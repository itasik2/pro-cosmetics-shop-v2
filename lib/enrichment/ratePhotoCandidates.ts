import sharp from "sharp";
import { safeFetchImage, type AllowedSourcePolicy } from "./network";
import { rankPhotoCandidates, type PhotoQuality } from "./photoQuality";
import type { VariantImageCandidate, VariantImageGroup } from "./variantImages";

const QUALITY_VERSION = 1;

export async function measurePhotoQuality(buffer: Buffer): Promise<PhotoQuality> {
  const image = sharp(buffer, { limitInputPixels: 40_000_000, animated: false });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height) throw new Error("photo_dimensions_missing");
  // Compare detail at the same scale; the dimensions always describe the source,
  // before the catalog's padded 1200px derivative is generated.
  const sample = await image.rotate().flatten({ background: "white" })
    .resize(256, 256, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const stats = await sharp(sample).stats();
  return { width: metadata.width, height: metadata.height,
    sharpness: Math.round(stats.sharpness * 100) / 100, version: QUALITY_VERSION };
}

export async function ratePhotoCandidates(
  values: VariantImageCandidate[],
  options: { policies: AllowedSourcePolicy[]; deadlineAt?: number },
  fetchImage = safeFetchImage,
) {
  const deadlineAt = Math.min(options.deadlineAt ?? Infinity, Date.now() + 8_000);
  const unique = [...new Map(values.map((candidate) => [candidate.url, candidate])).values()];
  let cursor = 0;
  async function worker() {
    while (cursor < unique.length && Date.now() < deadlineAt - 100) {
      const index = cursor++;
      const candidate = unique[index];
      if (candidate.quality?.version === QUALITY_VERSION &&
        candidate.quality.width > 0 && candidate.quality.height > 0 &&
        Number.isFinite(candidate.quality.width) && Number.isFinite(candidate.quality.height) &&
        Number.isFinite(candidate.quality.sharpness)) continue;
      try {
        const url = new URL(candidate.url);
        if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) continue;
        const fetched = await fetchImage(candidate.url, [
          ...options.policies, { domain: url.hostname, allowSubdomains: false },
        ], { timeoutMs: Math.min(3_000, Math.max(1, deadlineAt - Date.now())) });
        unique[index] = { ...candidate, quality: await measurePhotoQuality(fetched.buffer) };
      } catch {
        // An unavailable image never erases previously found or selected photos.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, unique.length) }, worker));
  return rankPhotoCandidates(unique);
}

export async function rateProposalPhotoGroups<T extends {
  variantImageCandidates: VariantImageGroup[];
  productImageCandidates: VariantImageGroup[];
  photoAutomation: Record<string, unknown>;
}>(photos: T, options: Parameters<typeof ratePhotoCandidates>[1]) {
  const all = [...photos.variantImageCandidates, ...photos.productImageCandidates];
  const rated = await ratePhotoCandidates(all.flatMap((group) => group.candidates), options);
  const byUrl = new Map(rated.map((candidate) => [candidate.url, candidate.quality]));
  const groups = (values: VariantImageGroup[]) => values.map((group) => ({
    ...group,
    candidates: rankPhotoCandidates(group.candidates.map((candidate) => ({
      ...candidate, ...(byUrl.get(candidate.url) ? { quality: byUrl.get(candidate.url) } : {}),
    }))),
  }));
  return { ...photos,
    variantImageCandidates: groups(photos.variantImageCandidates),
    productImageCandidates: groups(photos.productImageCandidates),
    photoAutomation: { ...photos.photoAutomation,
      qualityIncomplete: rated.some((candidate) => candidate.quality?.version !== QUALITY_VERSION) },
  };
}
