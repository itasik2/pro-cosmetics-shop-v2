"use client";

import { useEffect, useState } from "react";

type Settings = {
  scheduleEnabled: boolean;
  scheduleStart: string | null; // ISO UTC
  scheduleEnd: string | null; // ISO UTC
  backgroundUrl: string;
  bannerEnabled: boolean;
  bannerText: string;
  bannerHref: string | null;
};

const empty: Settings = {
  scheduleEnabled: false,
  scheduleStart: null,
  scheduleEnd: null,
  backgroundUrl: "",
  bannerEnabled: false,
  bannerText: "",
  bannerHref: null,
};

export default function AdminSettingsClient() {
  const [settings, setSettings] = useState<Settings>(empty);
  const [activeNow, setActiveNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setMsg(null);
    const res = await fetch("/api/site-settings", { cache: "no-store" });
    const data = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      setMsg(`Ошибка: ${data?.error || res.status}`);
      return;
    }
    setSettings(data.settings as Settings);
    setActiveNow(!!data.activeNow);
  }

  useEffect(() => {
    load();
  }, []);

  function setField<K extends keyof Settings>(k: K, v: Settings[K]) {
    setSettings((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    setBusy(true);
    setMsg(null);

    const res = await fetch("/api/site-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });

    const data = await res.json().catch(() => ({} as any));
    setBusy(false);

    if (!res.ok) {
      setMsg(`Ошибка: ${data?.error || res.status}`);
      return;
    }

    setSettings(data.settings as Settings);
    setActiveNow(!!data.activeNow);
    setMsg("Сохранено");
  }

  async function uploadBg(file: File) {
    setUploading(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);

      // переиспользуем твой upload endpoint
      const res = await fetch("/api/upload/product-image", {
        method: "POST",
        body: fd,
      });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(String(data?.error || res.status));

      const url = String(data?.url || "").trim();
      if (!url) throw new Error("no_url_returned");

      setField("backgroundUrl", url);
      setMsg("Фон загружен, не забудь нажать «Сохранить»");
    } catch (e: any) {
      setMsg(`Ошибка загрузки: ${e?.message || "upload_failed"}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">Настройки сайта</h2>
          <div className="text-sm text-gray-500 mt-1">
            Активно сейчас (UTC):{" "}
            <span className={activeNow ? "text-emerald-700" : "text-gray-500"}>
              {activeNow ? "да" : "нет"}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
          onClick={save}
          disabled={busy || uploading}
        >
          {busy ? "Сохранение…" : "Сохранить"}
        </button>
      </div>

      {msg ? <div className="text-sm">{msg}</div> : null}

      {/* Расписание UTC */}
      <div className="rounded-2xl border p-4 space-y-3 bg-white/80 backdrop-blur">
        <div className="font-semibold">Автовключение по датам (UTC)</div>

        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.scheduleEnabled}
            onChange={(e) => setField("scheduleEnabled", e.target.checked)}
          />
          <span>Включить расписание</span>
        </label>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <div className="text-sm text-gray-600 mb-1">Start (ISO UTC)</div>
            <input
              className="w-full border rounded-xl px-3 py-2"
              placeholder="2026-12-20T00:00:00Z"
              value={settings.scheduleStart ?? ""}
              onChange={(e) =>
                setField("scheduleStart", e.target.value.trim() || null)
              }
            />
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">End (ISO UTC)</div>
            <input
              className="w-full border rounded-xl px-3 py-2"
              placeholder="2027-01-10T23:59:59Z"
              value={settings.scheduleEnd ?? ""}
              onChange={(e) =>
                setField("scheduleEnd", e.target.value.trim() || null)
              }
            />
          </div>
        </div>

        <div className="text-xs text-gray-500">
          Если расписание включено: оформление активно только внутри интервала
          (UTC). Пустые даты означают «без границы».
        </div>
      </div>

      {/* Фон */}
      <div className="rounded-2xl border p-4 space-y-3 bg-white/80 backdrop-blur">
        <div className="font-semibold">Фон сайта</div>

        <div className="grid md:grid-cols-2 gap-3 items-start">
          <div>
            <div className="text-sm text-gray-600 mb-1">Загрузить фон</div>
            <input
              type="file"
              accept="image/*"
              className="w-full border rounded-xl px-3 py-2 bg-white"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                uploadBg(f);
                e.currentTarget.value = "";
              }}
            />
            <div className="text-xs text-gray-500 mt-1">
              Загружается в Cloudinary. Вставится URL.
            </div>
          </div>

          <div>
            <div className="text-sm text-gray-600 mb-1">URL фона</div>
            <input
              className="w-full border rounded-xl px-3 py-2"
              value={settings.backgroundUrl}
              onChange={(e) => setField("backgroundUrl", e.target.value)}
              placeholder="https://..."
            />
          </div>
        </div>

        {settings.backgroundUrl ? (
          <div className="pt-2">
            <div className="text-sm text-gray-600 mb-2">Превью</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={settings.backgroundUrl}
              alt="bg preview"
              className="w-full max-h-64 object-cover rounded-2xl border"
            />
          </div>
        ) : null}
      </div>

      {/* Баннер */}
      <div className="rounded-2xl border p-4 space-y-3 bg-white/80 backdrop-blur">
        <div className="font-semibold">Баннер</div>

        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.bannerEnabled}
            onChange={(e) => setField("bannerEnabled", e.target.checked)}
          />
          <span>Показывать баннер</span>
        </label>

        <div>
          <div className="text-sm text-gray-600 mb-1">Текст</div>
          <input
            className="w-full border rounded-xl px-3 py-2"
            value={settings.bannerText}
            onChange={(e) => setField("bannerText", e.target.value)}
            placeholder="Например: Новогодняя акция — скидки до 20%"
          />
        </div>

        <div>
          <div className="text-sm text-gray-600 mb-1">Ссылка (необязательно)</div>
          <input
            className="w-full border rounded-xl px-3 py-2"
            value={settings.bannerHref ?? ""}
            onChange={(e) =>
              setField("bannerHref", e.target.value.trim() || null)
            }
            placeholder="https://... или /shop"
          />
        </div>
      </div>
    </div>
  );
}
