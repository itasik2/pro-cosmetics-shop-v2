"use client";

import { useEffect, useMemo, useState } from "react";
import {
  normalizeThemeProfile,
  THEME_PROFILE_OPTIONS,
  type ThemeProfile,
} from "@/lib/themeProfiles";

const UPLOAD_ENDPOINT = "/api/upload/product-image";

type Settings = {
  id: string;
  themeProfile: ThemeProfile;
  scheduleEnabled: boolean;
  scheduleStart: string | null;
  scheduleEnd: string | null;

  backgroundUrl: string;

  bannerEnabled: boolean;
  bannerText: string;
  bannerHref: string | null;

  updatedAt: string;
};

type ApiGetResponse = {
  settings: Settings | null;
  activeNow: boolean;
};

function toISOorNull(v: string) {
  const s = (v || "").trim();
  return s ? s : null;
}

function toOptimizedCloudinaryUrl(url: string) {
  const u = (url || "").trim();
  if (!u) return "";
  if (!u.includes("/upload/")) return u;
  if (u.includes("/upload/f_auto")) return u;

  return u.replace("/upload/", "/upload/f_auto,q_auto,w_1920,c_limit/");
}

export default function AdminSettingsClient() {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleStart, setScheduleStart] = useState<string>("");
  const [scheduleEnd, setScheduleEnd] = useState<string>("");

  const [backgroundUrl, setBackgroundUrl] = useState<string>("");
  const [themeProfile, setThemeProfile] = useState<ThemeProfile>("neutral");

  const [bannerEnabled, setBannerEnabled] = useState(false);
  const [bannerText, setBannerText] = useState("");
  const [bannerHref, setBannerHref] = useState("");

  const [activeNow, setActiveNow] = useState(true);

  async function load() {
    setLoading(true);
    setMsg(null);

    try {
      const res = await fetch("/api/site-settings", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as ApiGetResponse;

      const s = data?.settings;

      setScheduleEnabled(!!s?.scheduleEnabled);
      setScheduleStart(s?.scheduleStart ? String(s.scheduleStart) : "");
      setScheduleEnd(s?.scheduleEnd ? String(s.scheduleEnd) : "");

      setBackgroundUrl(s?.backgroundUrl ? String(s.backgroundUrl) : "");
      setThemeProfile(normalizeThemeProfile(s?.themeProfile));

      setBannerEnabled(!!s?.bannerEnabled);
      setBannerText(s?.bannerText ? String(s.bannerText) : "");
      setBannerHref(s?.bannerHref ? String(s.bannerHref) : "");

      setActiveNow(!!data?.activeNow);
    } catch (e: any) {
      setMsg(`Ошибка загрузки: ${e?.message || "failed"}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const savePayload = useMemo(() => {
    return {
      scheduleEnabled,
      scheduleStart: toISOorNull(scheduleStart),
      scheduleEnd: toISOorNull(scheduleEnd),

      backgroundUrl: (backgroundUrl || "").trim(),
      themeProfile,

      bannerEnabled,
      bannerText: (bannerText || "").trim(),
      bannerHref: toISOorNull(bannerHref),
    };
  }, [
    scheduleEnabled,
    scheduleStart,
    scheduleEnd,
    backgroundUrl,
    themeProfile,
    bannerEnabled,
    bannerText,
    bannerHref,
  ]);

  async function save() {
    setBusy(true);
    setMsg(null);

    try {
      const res = await fetch("/api/site-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(savePayload),
      });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setMsg(`Ошибка: ${data?.error || res.status}`);
        return;
      }

      setMsg("Сохранено");
      await load();
    } catch (e: any) {
      setMsg(`Ошибка: ${e?.message || "failed"}`);
    } finally {
      setBusy(false);
    }
  }

  async function uploadBackground(file: File) {
    setBusy(true);
    setMsg(null);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch(UPLOAD_ENDPOINT, {
        method: "POST",
        body: fd,
      });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        setMsg(`Ошибка загрузки: ${data?.error || res.status}`);
        return;
      }

      const rawUrl = String(
        data?.secure_url ||
          data?.url ||
          data?.result?.secure_url ||
          data?.result?.url ||
          "",
      ).trim();

      if (!rawUrl) {
        setMsg("Ошибка загрузки: не получен URL");
        return;
      }

      const optimized = toOptimizedCloudinaryUrl(rawUrl);
      setBackgroundUrl(optimized);

      setMsg('Фон загружен. Не забудь нажать «Сохранить».');
    } catch (e: any) {
      setMsg(`Ошибка загрузки: ${e?.message || "upload_failed"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold">Настройки сайта</h2>
          <div className="text-sm text-gray-600 mt-1 break-words">
            Активно сейчас (UTC):{" "}
            <span className="font-semibold">{activeNow ? "да" : "нет"}</span>
          </div>
        </div>

        <button
          type="button"
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-50 w-full sm:w-auto"
          onClick={save}
          disabled={busy || loading}
        >
          {busy ? "Сохранение…" : "Сохранить"}
        </button>
      </div>

      {msg ? <div className="text-sm">{msg}</div> : null}

      {loading ? (
        <div className="text-sm text-gray-500">Загрузка…</div>
      ) : (
        <>
          <div className="rounded-2xl border p-4 space-y-3">
            <div className="font-semibold">Автовключение по датам (UTC)</div>

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={scheduleEnabled}
                onChange={(e) => setScheduleEnabled(e.target.checked)}
              />
              <span>Включить расписание</span>
            </label>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="min-w-0">
                <div className="text-sm text-gray-600 mb-1">Start (ISO UTC)</div>
                <input
                  className="w-full border rounded-xl px-3 py-2"
                  value={scheduleStart}
                  onChange={(e) => setScheduleStart(e.target.value)}
                  placeholder="2026-01-10T00:00:00.000Z"
                />
              </div>

              <div className="min-w-0">
                <div className="text-sm text-gray-600 mb-1">End (ISO UTC)</div>
                <input
                  className="w-full border rounded-xl px-3 py-2"
                  value={scheduleEnd}
                  onChange={(e) => setScheduleEnd(e.target.value)}
                  placeholder="2026-01-20T00:00:00.000Z"
                />
              </div>
            </div>

            <div className="text-xs text-gray-500">
              Если расписание включено: оформление активно только внутри интервала (UTC). Пустые даты означают «без
              границы».
            </div>
          </div>

          <div className="rounded-2xl border p-4 space-y-3">
            <div className="font-semibold">Фон сайта</div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="min-w-0">
                <div className="text-sm text-gray-600 mb-1">Загрузить фон</div>

                <input
                  type="file"
                  accept="image/*"
                  className="max-w-full"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadBackground(f);
                    e.currentTarget.value = "";
                  }}
                />

                <div className="text-xs text-gray-500 mt-2">
                  Загружается в Cloudinary. GIF автоматически оптимизируется (animated WebP). В настройки подставится
                  оптимизированный URL.
                </div>
              </div>

              <div className="min-w-0">
                <div className="text-sm text-gray-600 mb-1">URL фона</div>
                <input
                  className="w-full border rounded-xl px-3 py-2"
                  value={backgroundUrl}
                  onChange={(e) => setBackgroundUrl(e.target.value)}
                  placeholder="https://res.cloudinary.com/.../image/upload/..."
                />

                {backgroundUrl ? (
                  <div className="mt-3">
                    <div className="text-sm text-gray-600 mb-2">Превью</div>
                    <div className="rounded-xl border overflow-hidden">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={backgroundUrl}
                        alt="background preview"
                        className="block w-full max-w-full h-40 object-cover"
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <fieldset className="rounded-2xl border p-4 space-y-3">
            <legend className="px-1 font-semibold">Цветовой профиль</legend>
            <p className="text-sm text-gray-600">
              Выберите спокойный акцент под сезонный или праздничный фон.
              Структура сайта и фотографии товаров не меняются.
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {THEME_PROFILE_OPTIONS.map((option) => {
                const selected = themeProfile === option.value;
                return (
                  <label
                    key={option.value}
                    className={`cursor-pointer rounded-xl border p-3 transition ${
                      selected
                        ? "border-gray-800 bg-gray-50 ring-1 ring-gray-800"
                        : "border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="themeProfile"
                        value={option.value}
                        checked={selected}
                        onChange={() => setThemeProfile(option.value)}
                      />
                      <span
                        className="h-7 w-7 shrink-0 rounded-full border border-black/10"
                        style={{
                          background: `linear-gradient(135deg, ${option.soft} 0 50%, ${option.accent} 50% 100%)`,
                        }}
                        aria-hidden="true"
                      />
                      <span className="font-medium">{option.label}</span>
                    </span>
                    <span className="mt-2 block text-xs leading-5 text-gray-500">
                      {option.description}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="rounded-2xl border p-4 space-y-3">
            <div className="font-semibold">Баннер</div>

            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={bannerEnabled}
                onChange={(e) => setBannerEnabled(e.target.checked)}
              />
              <span>Показывать баннер</span>
            </label>

            <div className="min-w-0">
              <div className="text-sm text-gray-600 mb-1">Текст</div>
              <input
                className="w-full border rounded-xl px-3 py-2"
                value={bannerText}
                onChange={(e) => setBannerText(e.target.value)}
                placeholder="Например: Новогодняя акция — скидки до 20%"
              />
            </div>

            <div className="min-w-0">
              <div className="text-sm text-gray-600 mb-1">Ссылка (необязательно)</div>
              <input
                className="w-full border rounded-xl px-3 py-2"
                value={bannerHref}
                onChange={(e) => setBannerHref(e.target.value)}
                placeholder="https://... или /shop"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
