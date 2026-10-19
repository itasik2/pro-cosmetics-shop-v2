import test from "node:test";
import assert from "node:assert/strict";
import { dateFromFileName, previousAppliedDate } from "./import-date";

test("extracts a real date from the supplier filename", () => {
  assert.equal(dateFromFileName("Прайс 10.02.2026 (Клиенты).pdf"), "2026-02-10");
  assert.equal(dateFromFileName("JeuDerm 23012026.pdf"), "2026-01-23");
  assert.equal(dateFromFileName("Прайс 31.02.2026.pdf"), null);
});

test("compares only completed imports from the same supplier profile", () => {
  const rows = [
    { profileId:"a", fileName:"Прайс 10.02.2026.pdf", action:"APPLY", result:"COMPLETED" },
    { profileId:"a", fileName:"Прайс 20.03.2026.pdf", action:"PREVIEW", result:"PREVIEWED" },
    { profileId:"b", fileName:"Прайс 20.03.2026.pdf", action:"APPLY", result:"COMPLETED" },
  ];
  assert.equal(previousAppliedDate(rows,"a"),"2026-02-10");
  assert.equal(previousAppliedDate(rows,null),null);
});
