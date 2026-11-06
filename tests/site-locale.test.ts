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
