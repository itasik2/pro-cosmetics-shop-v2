import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const SIDE = 320;
const PIXELS = SIDE * SIDE;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

async function loadModel() {
  const ort = await import("onnxruntime-web");
  ort.env.wasm.numThreads = 1;
  const model = await readFile(join(process.cwd(), ".photo-models", "u2netp.onnx"));
  const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
  return { ort, session };
}

let modelPromise: ReturnType<typeof loadModel> | undefined;

/** Removes the background and keeps the original alpha around transparent artwork. */
export async function productCutout(bytes: Buffer) {
  const oriented = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" })
    .rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb").png().toBuffer();
  const [rgba, input] = await Promise.all([
    sharp(oriented).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(oriented).flatten({ background: "#ffffff" })
      .resize(SIDE, SIDE, { fit: "fill" }).raw().toBuffer(),
  ]);
  // Studio PNGs with an existing transparent background already have their own matte.
  let transparent = 0;
  for (let i = 3; i < rgba.data.length; i += 4) if (rgba.data[i] < 8) transparent++;
  if (transparent > rgba.info.width * rgba.info.height * 0.04) return oriented;

  const tensor = new Float32Array(PIXELS * 3);
  for (let channel = 0; channel < 3; channel++) {
    for (let i = 0; i < PIXELS; i++) {
      tensor[channel * PIXELS + i] = (input[i * 3 + channel] / 255 - MEAN[channel]) / STD[channel];
    }
  }
  modelPromise ??= loadModel().catch((error) => {
    modelPromise = undefined;
    throw error;
  });
  const { ort, session } = await modelPromise;
  const prediction = session.outputNames[0];
  const result = await session.run({
    [session.inputNames[0]]: new ort.Tensor("float32", tensor, [1, 3, SIDE, SIDE]),
  }, [prediction]);
  const scores = result[prediction].data as Float32Array;
  if (scores.length !== PIXELS) throw new Error("background_mask_invalid");
  const matte = Buffer.alloc(PIXELS);
  let foreground = 0;
  for (let i = 0; i < PIXELS; i++) {
    const certainty = Math.max(0, Math.min(1, (scores[i] - 0.12) / 0.76));
    matte[i] = Math.round(certainty * 255);
    if (matte[i] > 127) foreground++;
  }
  if (foreground < PIXELS * 0.01 || foreground > PIXELS * 0.985) {
    throw new Error("background_mask_uncertain");
  }
  const alpha = await sharp(matte, { raw: { width: SIDE, height: SIDE, channels: 1 } })
    .resize(rgba.info.width, rgba.info.height, { fit: "fill", kernel: "linear" })
    .greyscale().raw().toBuffer();
  for (let i = 0; i < alpha.length; i++) {
    rgba.data[i * 4 + 3] = Math.round(rgba.data[i * 4 + 3] * alpha[i] / 255);
  }
  return sharp(rgba.data, { raw: rgba.info }).png().toBuffer();
}
