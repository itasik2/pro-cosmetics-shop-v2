import { createHash } from "node:crypto";

type PhotoResponse = { buffer: Buffer; contentType: string; finalUrl: string };
type ImageInfo = { width?: number; height?: number; format?: string; pages?: number };
export type VerifiedPhoto = {
  url: string; requestedUrl: string; width: number; height: number;
  sha256: string; checkedAt: string; status: "REVIEW_REQUIRED";
};

export async function verifyProductImages(
  urls: string[],
  fetchImage: (url: string) => Promise<PhotoResponse>,
  decodeImage: (bytes: Buffer) => Promise<ImageInfo>,
) {
  const candidates = [...new Set(urls)].slice(0, 6);
  const inspect = async (url: string) => {
    const response = await fetchImage(url);
    const info = await decodeImage(response.buffer);
    const { width, height } = info;
    const mime = info.format === "jpg" ? "image/jpeg" : "image/" + info.format;
    if (!width || !height || Math.min(width, height) < 200 ||
      Math.max(width, height) / Math.min(width, height) > 5 ||
      (info.pages ?? 1) > 1 || response.contentType !== mime) {
      throw new Error("photo_file_not_usable");
    }
    return {
      url: response.finalUrl, requestedUrl: url, width, height,
      sha256: createHash("sha256").update(response.buffer).digest("hex"),
      checkedAt: new Date().toISOString(), status: "REVIEW_REQUIRED" as const,
    };
  };
  const checked: PromiseSettledResult<VerifiedPhoto>[] = [];
  for (let offset = 0; offset < candidates.length; offset += 2) {
    checked.push(...await Promise.allSettled(candidates.slice(offset, offset + 2).map(inspect)));
  }
  const unique = new Map<string, VerifiedPhoto>();
  for (const result of checked) {
    if (result.status === "fulfilled" && !unique.has(result.value.sha256)) {
      unique.set(result.value.sha256, result.value);
    }
  }
  const images = [...unique.values()].sort((a, b) =>
    Math.min(b.width, b.height) - Math.min(a.width, a.height) || b.width * b.height - a.width * a.height);
  return {
    images,
    warnings: checked.some(result => result.status === "rejected") ? ["photo_files_rejected"] : [],
  };
}
