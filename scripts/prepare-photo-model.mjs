import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";

// U²-NetP (Apache-2.0), ONNX conversion distributed by rembg.
const folder = new URL("../.photo-models/", import.meta.url);
const model = new URL("u2netp.onnx", folder);
const checksum = "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const existing = await readFile(model).catch((error) => {
  if (error.code === "ENOENT") return null;
  throw error;
});

if (!existing || hash(existing) !== checksum) {
  const response = await fetch("https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx", {
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error("U²-NetP download returned HTTP " + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== checksum) throw new Error("U²-NetP checksum mismatch");
  await mkdir(folder, { recursive: true });
  const temporary = new URL("u2netp." + process.pid + ".tmp", folder);
  await writeFile(temporary, bytes);
  await rename(temporary, model);
}
