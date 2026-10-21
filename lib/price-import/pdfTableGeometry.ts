export type PdfTableItem = {
  text: string;
  x: number;
  top: number;
  width: number;
  height: number;
};
export type PdfTableRule = { x1: number; x2: number; top: number };
export type PdfTablePage = {
  pageNumber: number;
  width: number;
  height: number;
  items: PdfTableItem[];
  horizontal: PdfTableRule[];
  vertical: { x: number; top: number; bottom: number }[];
};

export async function readTablePages(
  bytes: Uint8Array,
): Promise<PdfTablePage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({
    data: bytes.slice(),
    useSystemFonts: true,
    verbosity: 0,
  }).promise;
  try {
    if (document.numPages > 40)
      throw new Error(`pdf_too_many_pages:${document.numPages}`);
    const pages: PdfTablePage[] = [];
    for (let n = 1; n <= document.numPages; n++) {
      const page = await document.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const text = await page.getTextContent();
      const result: PdfTablePage = {
        pageNumber: n,
        width: viewport.width,
        height: viewport.height,
        items: [],
        horizontal: [],
        vertical: [],
      };
      for (const item of text.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const point = viewport.convertToViewportPoint(
          item.transform[4],
          item.transform[5],
        );
        result.items.push({
          text: item.str.replace(/\s+/g, " ").trim(),
          x: point[0],
          top: point[1],
          width: item.width,
          height: item.height,
        });
      }
      const operators = await page.getOperatorList();
      let matrix = [1, 0, 0, 1, 0, 0];
      const stack: number[][] = [];
      let pending: { a: number[]; b: number[]; fill: boolean }[] = [];
      const point = (x: number, y: number) =>
        viewport.convertToViewportPoint(
          matrix[0] * x + matrix[2] * y + matrix[4],
          matrix[1] * x + matrix[3] * y + matrix[5],
        );
      function segment(a: number[], b: number[], fill: boolean) {
        pending.push({ a, b, fill });
      }
      function paint(stroke: boolean) {
        for (const { a, b, fill } of pending) {
          if (!stroke && !fill) continue;
          if (Math.abs(a[1] - b[1]) < 1 && Math.abs(a[0] - b[0]) > 10)
            result.horizontal.push({
              x1: Math.min(a[0], b[0]),
              x2: Math.max(a[0], b[0]),
              top: (a[1] + b[1]) / 2,
            });
          if (Math.abs(a[0] - b[0]) < 1 && Math.abs(a[1] - b[1]) > 10)
            result.vertical.push({
              x: (a[0] + b[0]) / 2,
              top: Math.min(a[1], b[1]),
              bottom: Math.max(a[1], b[1]),
            });
        }
        pending = [];
      }
      for (let i = 0; i < operators.fnArray.length; i++) {
        const fn = operators.fnArray[i];
        const args = operators.argsArray[i];
        if (fn === pdfjs.OPS.save) stack.push([...matrix]);
        else if (fn === pdfjs.OPS.restore)
          matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
        else if (fn === pdfjs.OPS.transform) {
          const [a, b, c, d, e, f] = args as number[];
          const m = matrix;
          matrix = [
            m[0] * a + m[2] * b,
            m[1] * a + m[3] * b,
            m[0] * c + m[2] * d,
            m[1] * c + m[3] * d,
            m[0] * e + m[2] * f + m[4],
            m[1] * e + m[3] * f + m[5],
          ];
        } else if (fn === pdfjs.OPS.constructPath) {
          const [commands, coordinates] = args as [number[], number[]];
          let offset = 0;
          let cursor: number[] | null = null;
          for (const command of commands) {
            if (command === pdfjs.OPS.rectangle) {
              const [x, y, w, h] = coordinates.slice(offset, offset + 4);
              offset += 4;
              const a = point(x, y),
                b = point(x + w, y),
                c = point(x + w, y + h),
                d = point(x, y + h);
              if (Math.abs(h) <= 2)
                segment(point(x, y + h / 2), point(x + w, y + h / 2), true);
              else if (Math.abs(w) <= 2)
                segment(point(x + w / 2, y), point(x + w / 2, y + h), true);
              else {
                segment(a, b, false);
                segment(b, c, false);
                segment(c, d, false);
                segment(d, a, false);
              }
            } else if (
              command === pdfjs.OPS.moveTo ||
              command === pdfjs.OPS.lineTo
            ) {
              const next = point(coordinates[offset], coordinates[offset + 1]);
              offset += 2;
              if (command === pdfjs.OPS.lineTo && cursor)
                segment(cursor, next, false);
              cursor = next;
            } else if (command === pdfjs.OPS.curveTo) offset += 6;
            else if (
              command === pdfjs.OPS.curveTo2 ||
              command === pdfjs.OPS.curveTo3
            )
              offset += 4;
          }
        } else if (
          [
            pdfjs.OPS.stroke,
            pdfjs.OPS.closeStroke,
            pdfjs.OPS.fillStroke,
            pdfjs.OPS.eoFillStroke,
            pdfjs.OPS.closeFillStroke,
            pdfjs.OPS.closeEOFillStroke,
          ].includes(fn)
        )
          paint(true);
        else if ([pdfjs.OPS.fill, pdfjs.OPS.eoFill].includes(fn)) paint(false);
        else if (fn === pdfjs.OPS.endPath) pending = [];
      }
      pages.push(result);
    }
    return pages;
  } finally {
    await document.destroy();
  }
}
