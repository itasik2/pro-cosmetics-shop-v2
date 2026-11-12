import assert from "node:assert/strict";
import test from "node:test";
import { isLocalizablePath, localeInPath, localizedHref, parseSiteLocale, stripLocale, uiText } from "../lib/i18n";

test("new Kazakh and English paths preserve existing Russian URLs", () => {
  assert.equal(localizedHref("/shop?brand=skinosophy&category=kremy#products", "ru"), "/shop?brand=skinosophy&category=kremy#products");
  assert.equal(localizedHref("/shop?brand=skinosophy&category=kremy#products", "kk"), "/kk/shop?brand=skinosophy&category=kremy#products");
  assert.equal(localizedHref("/kk/shop/item-one?q=cream", "en"), "/en/shop/item-one?q=cream");
  assert.equal(localizedHref("/en", "ru"), "/");
  assert.equal(stripLocale("/kk/shop/example"), "/shop/example");
  assert.equal(localeInPath("/en/checkout"), "en");
  assert.equal(localeInPath("/shop"), null);
});

test("admin and backend links must never be localized or rewritten", () => {
  for (const path of ["/api/checkout", "/admin/orders", "/order/token", "/_next/static/test.js", "/payment/callback"]) {
    assert.equal(isLocalizablePath(path), false, path);
    assert.equal(localizedHref(path, "kk"), path, path);
  }
  assert.equal(localizedHref("https://example.com/shop", "en"), "https://example.com/shop");
  assert.equal(localizedHref("#details", "en"), "#details");
});

test("all three locales have correct common navigation translations", () => {
  assert.equal(parseSiteLocale("xx"), "ru");
  assert.equal(uiText("ru", "Корзина"), "Корзина");
  assert.equal(uiText("kk", "Корзина"), "Себет");
  assert.equal(uiText("en", "Корзина"), "Cart");
  assert.equal(uiText("en", "Сыворотки"), "Serums");
  assert.equal(uiText("kk", "Новинки"), "Жаңалықтар");
  assert.equal(uiText("en", "Unknown product name"), "Unknown product name");
});

test("mobile header keeps language and navigation controls compact", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const languageSource = readFileSync(join(process.cwd(), "components/LanguageSwitcher.tsx"), "utf8");
  const navbarSource = readFileSync(join(process.cwd(), "components/Navbar.tsx"), "utf8");

  assert.ok(languageSource.includes("<select"));
  assert.ok(languageSource.includes('aria-label={t("Выбор языка")}'));
  assert.ok(languageSource.includes("w-[52px]"));
  assert.ok(languageSource.includes("border-0 bg-transparent"));
  assert.ok(languageSource.includes("text-[11px] font-normal"));
  assert.ok(navbarSource.includes("absolute right-1 top-1/2"));
  assert.ok(navbarSource.includes("pr-[68px]"));
  assert.ok(navbarSource.includes("min-w-0 flex-1 truncate"));
  assert.equal((navbarSource.match(/<LanguageSwitcher \/>/g) || []).length, 1);
  assert.ok(languageSource.includes("<option"));
  assert.ok(!languageSource.includes("<a "));
  assert.ok(navbarSource.includes("h-8 w-auto sm:h-12"));
  assert.ok(navbarSource.includes("h-9 w-9 shrink-0"));
  assert.ok(navbarSource.includes('aria-label={open ? t("Закрыть") : t("Меню")}'));
});

test("critical storefront and blog copy has translations in both languages", () => {
  const title = "Профессиональная косметика для ухода, которая подходит именно вашей коже.";
  const subtitle = "Подбирайте средства по типу и потребностям кожи. В каждой карточке — назначение, способ применения и понятные рекомендации.";
  for (const locale of ["kk", "en"] as const) {
    for (const value of [title, subtitle, "новости"]) {
      assert.notEqual(uiText(locale, value), value);
    }
  }
});

test("about section renders localized headings and list text", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const about = readFileSync(join(process.cwd(), "app/about/page.tsx"), "utf8");
  assert.ok(about.includes("{t(principle.title)}"));
  assert.ok(about.includes("{t(benefit)}"));
});
