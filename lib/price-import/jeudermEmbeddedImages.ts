import { deflateSync, inflateSync } from "node:zlib";

export type JeudermEmbeddedImage = {
  pageNumber: number;
  visualIndex: number;
  mimeType: "image/jpeg" | "image/png";
  dataBase64: string;
  width: number;
  height: number;
};

type ObjectEntry = {
  id: number;
  start: number;
  end: number;
};

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function objectEntries(source: string): ObjectEntry[] {
  const matches: Array<{ id: number; start: number }> = [];
  const re = /(?:^|[\r\n])(\d+)\s+0\s+obj\b/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(source))) {
    matches.push({
      id: Number(match[1]),
      start:
        match.index +
        (match[0].startsWith("\r") || match[0].startsWith("\n") ? 1 : 0),
    });
  }

  return matches.map((entry, index) => ({
    ...entry,
    end: matches[index + 1]?.start ?? source.length,
  }));
}

function numberFromDict(dict: string, name: string) {
  const match = dict.match(new RegExp(`/${name}\\s+(\\d+)`));
  return match ? Number(match[1]) : null;
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function rgbToPng(rgb: Buffer, width: number, height: number) {
  if (rgb.length !== width * height * 3) {
    throw new Error("jeuderm_embedded_image_rgb_size_mismatch");
  }

  const scanlines = Buffer.alloc((width * 3 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    const outputOffset = row * (width * 3 + 1);
    scanlines[outputOffset] = 0;
    rgb.copy(
      scanlines,
      outputOffset + 1,
      row * width * 3,
      (row + 1) * width * 3,
    );
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(scanlines, { level: 6 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function streamData(input: {
  bytes: Uint8Array;
  source: string;
  entry: ObjectEntry;
  dict: string;
}) {
  const length = numberFromDict(input.dict, "Length");
  if (!length || length <= 0) return null;

  const segment = input.source.slice(input.entry.start, input.entry.end);
  const relativeStream = segment.indexOf("stream");
  if (relativeStream < 0) return null;

  let start = input.entry.start + relativeStream + "stream".length;
  if (input.source.startsWith("\r\n", start)) start += 2;
  else if (input.source[start] === "\r" || input.source[start] === "\n") start += 1;

  if (start + length > input.bytes.length) return null;
  return Buffer.from(input.bytes.slice(start, start + length));
}

function isDecorativeImage(width: number, height: number) {
  if (width === 268 && height === 80) return true;
  if (width <= 70 && height <= 80) return true;
  return false;
}

export function extractJeudermEmbeddedImages(bytes: Uint8Array) {
  const source = Buffer.from(bytes).toString("latin1");
  const entries = objectEntries(source);
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const pageEntries = entries.filter((entry) => {
    const segment = source.slice(entry.start, entry.end);
    return /\/Type\s*\/Page\b/.test(segment) && !/\/Type\s*\/Pages\b/.test(segment);
  });

  const result = new Map<number, JeudermEmbeddedImage[]>();

  pageEntries.forEach((pageEntry, pageIndex) => {
    const pageText = source.slice(pageEntry.start, pageEntry.end);
    const xObjectMatch = pageText.match(/\/XObject\s*<<(.*?)>>/s);
    if (!xObjectMatch) return;

    const refs: Array<{ resourceIndex: number; objectId: number }> = [];
    const refRe = /\/Image(\d+)\s+(\d+)\s+0\s+R/g;
    let match: RegExpExecArray | null;
    while ((match = refRe.exec(xObjectMatch[1]))) {
      refs.push({ resourceIndex: Number(match[1]), objectId: Number(match[2]) });
    }
    refs.sort((a, b) => a.resourceIndex - b.resourceIndex);

    const images: JeudermEmbeddedImage[] = [];
    for (const ref of refs) {
      const entry = byId.get(ref.objectId);
      if (!entry) continue;
      const segment = source.slice(entry.start, entry.end);
      const relativeStream = segment.indexOf("stream");
      const dict = relativeStream >= 0 ? segment.slice(0, relativeStream) : segment;

      if (!/\/Subtype\s*\/Image\b/.test(dict)) continue;
      if (!/\/ColorSpace\s*\/DeviceRGB\b/.test(dict)) continue;

      const width = numberFromDict(dict, "Width");
      const height = numberFromDict(dict, "Height");
      if (!width || !height || isDecorativeImage(width, height)) continue;

      const encoded = streamData({ bytes, source, entry, dict });
      if (!encoded) continue;

      try {
        if (/\/Filter\s*\/DCTDecode\b/.test(dict)) {
          images.push({
            pageNumber: pageIndex + 1,
            visualIndex: images.length,
            mimeType: "image/jpeg",
            dataBase64: encoded.toString("base64"),
            width,
            height,
          });
          continue;
        }

        if (/\/Filter\s*\/FlateDecode\b/.test(dict)) {
          const rgb = inflateSync(encoded);
          const png = rgbToPng(rgb, width, height);
          images.push({
            pageNumber: pageIndex + 1,
            visualIndex: images.length,
            mimeType: "image/png",
            dataBase64: png.toString("base64"),
            width,
            height,
          });
        }
      } catch {
        // Одна битая картинка не должна ломать весь импорт прайса.
      }
    }

    result.set(pageIndex + 1, images);
  });

  return result;
}
