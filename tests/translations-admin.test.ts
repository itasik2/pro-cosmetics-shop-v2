import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contentSourceHash } from "../lib/localizedContent";

test("source fingerprint detects meaningful changes to the Russian copy", () => {
  const first = contentSourceHash("Маска Skinosophy", "Увлажняющая маска", "Для какой кожи\nЧувствительная.");
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, contentSourceHash("Маска Skinosophy", "Увлажняющая маска", "Для какой кожи\nЧувствительная."));
  assert.notEqual(first, contentSourceHash("Маска Skinosophy", "Увлажняющая маска", "Для какой кожи\nСухая."));
});

test("translation administration never bypasses admin guard or silently publishes AI", () => {
  const route = readFileSync(join(process.cwd(), "app/api/admin/translations/route.ts"), "utf8");
  const ui = readFileSync(join(process.cwd(), "app/admin/(private)/translations/AdminTranslationsClient.tsx"), "utf8");
  assert.match(route, /await requireAdmin\(\)/);
  assert.match(route, /source\.hash !== sourceHash/);
  assert.match(route, /status === "PUBLISHED"/);
  assert.match(ui, /Подготовить черновик ИИ/);
  assert.match(ui, /Опубликовать перевод/);
});

test("bulk translation stops on the first upstream error and shows provider code", () => {
  const route = readFileSync(join(process.cwd(), "app/api/admin/translations/route.ts"), "utf8");
  const ui = readFileSync(join(process.cwd(), "app/admin/(private)/translations/AdminTranslationsClient.tsx"), "utf8");
  assert.match(route, /translation_provider_rejected/);
  assert.match(route, /providerStatus: response.status/);
  assert.match(route, /translation_connection_failed/);
  assert.match(ui, /readableError/);
  assert.match(ui, /const ok = await processOne\(pending\[0\]\)/);
  assert.match(ui, /if \(!ok\) stopBulk.current = true/);
  assert.match(ui, /Дальнейшие запросы остановлены/);
});
