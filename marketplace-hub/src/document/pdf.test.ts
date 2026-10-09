import assert from "node:assert/strict";
import test from "node:test";
import { extractPdfCatalogRows } from "./pdf.js";

test("rejects empty PDF input before parsing", async () => {
  await assert.rejects(
    () => extractPdfCatalogRows(new Uint8Array()),
    /pdf_empty/,
  );
});
