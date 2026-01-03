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
      setMsg(`\u041e\u0448\u0438\u0431\u043a\u0430: ${data?.error || res.status}`);
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
      setMsg(`\u041e\u0448\u0438\u0431\u043a\u0430: ${data?.error || res.status}`);
      return;
    }

    setSettings(data.settings as Settings);
    setActiveNow(!!data.activeNow);
    setMsg("\u0421\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043e");
  }

  async function uploadBg(file: File) {
    setUploading(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);

      // \u043f\u0435\u0440\u0435\u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u043c \u0442\u0432\u043e\u0439 upload endpoint
      const res = await fetch("/api/upload/product-image", {
        method: "POST",
        body: fd,
      });

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) throw new Error(String(data?.error || res.status));

      const url = String(data?.url || "").trim();
      if (!url) throw new Error("no_url_returned");

      setField("backgroundUrl", url);
      setMsg("\u0424\u043e\u043d \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043d, \u043d\u0435 \u0437\u0430\u0431\u0443\u0434\u044c \u043d\u0430\u0436\u0430\u0442\u044c �\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c�");
    } catch (e: any) {
      setMsg(`\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438: ${e?.message || "upload_failed"}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold">\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u0441\u0430\u0439\u0442\u0430</h2>
          <div className="text-sm text-gray-500 mt-1">
            \u0410\u043a\u0442\u0438\u0432\u043d\u043e \u0441\u0435\u0439\u0447\u0430\u0441 (UTC):{" "}
            <span className={activeNow ? "text-emerald-700" : "text-gray-500"}>
              {activeNow ? "\u0434\u0430" : "\u043d\u0435\u0442"}
            </span>
          </div>
        </div>

        <button
          type="button"
          className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
          onClick={save}
          disabled={busy || uploading}
        >
          {busy ? "\u0421\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u0438\u0435\u2026" : "\u0421\u043e\u0445\u0440\u0430\u043d\u0438\u0442\u044c"}
        </button>
      </div>

      {msg ? <div className="text-sm">{msg}</div> : null}

      {/* \u0420\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435 UTC */}
      <div className="rounded-2xl border p-4 space-y-3 bg-white/80 backdrop-blur">
        <div className="font-semibold">\u0410\u0432\u0442\u043e\u0432\u043a\u043b\u044e\u0447\u0435\u043d\u0438\u0435 \u043f\u043e \u0434\u0430\u0442\u0430\u043c (UTC)</div>

        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.scheduleEnabled}
            onChange={(e) => setField("scheduleEnabled", e.target.checked)}
          />
          <span>\u0412\u043a\u043b\u044e\u0447\u0438\u0442\u044c \u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435</span>
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
          \u0415\u0441\u043b\u0438 \u0440\u0430\u0441\u043f\u0438\u0441\u0430\u043d\u0438\u0435 \u0432\u043a\u043b\u044e\u0447\u0435\u043d\u043e: \u043e\u0444\u043e\u0440\u043c\u043b\u0435\u043d\u0438\u0435 \u0430\u043a\u0442\u0438\u0432\u043d\u043e \u0442\u043e\u043b\u044c\u043a\u043e \u0432\u043d\u0443\u0442\u0440\u0438 \u0438\u043d\u0442\u0435\u0440\u0432\u0430\u043b\u0430
          (UTC). \u041f\u0443\u0441\u0442\u044b\u0435 \u0434\u0430\u0442\u044b \u043e\u0437\u043d\u0430\u0447\u0430\u044e\u0442 �\u0431\u0435\u0437 \u0433\u0440\u0430\u043d\u0438\u0446\u044b�.
        </div>
      </div>

      {/* \u0424\u043e\u043d */}
      <div className="rounded-2xl border p-4 space-y-3 bg-white/80 backdrop-blur">
        <div className="font-semibold">\u0424\u043e\u043d \u0441\u0430\u0439\u0442\u0430</div>

        <div className="grid md:grid-cols-2 gap-3 items-start">
          <div>
            <div className="text-sm text-gray-600 mb-1">\u0417\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0444\u043e\u043d</div>
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
              \u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u0442\u0441\u044f \u0432 Cloudinary. \u0412\u0441\u0442\u0430\u0432\u0438\u0442\u0441\u044f URL.
            </div>
          </div>

          <div>
            <div className="text-sm text-gray-600 mb-1">URL \u0444\u043e\u043d\u0430</div>
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
            <div className="text-sm text-gray-600 mb-2">\u041f\u0440\u0435\u0432\u044c\u044e</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={settings.backgroundUrl}
              alt="bg preview"
              className="w-full max-h-64 object-cover rounded-2xl border"
            />
          </div>
        ) : null}
      </div>

      {/* \u0411\u0430\u043d\u043d\u0435\u0440 */}
      <div className="rounded-2xl border p-4 space-y-3 bg-white/80 backdrop-blur">
        <div className="font-semibold">\u0411\u0430\u043d\u043d\u0435\u0440</div>

        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.bannerEnabled}
            onChange={(e) => setField("bannerEnabled", e.target.checked)}
          />
          <span>\u041f\u043e\u043a\u0430\u0437\u044b\u0432\u0430\u0442\u044c \u0431\u0430\u043d\u043d\u0435\u0440</span>
        </label>

        <div>
          <div className="text-sm text-gray-600 mb-1">\u0422\u0435\u043a\u0441\u0442</div>
          <input
            className="w-full border rounded-xl px-3 py-2"
            value={settings.bannerText}
            onChange={(e) => setField("bannerText", e.target.value)}
            placeholder="\u041d\u0430\u043f\u0440\u0438\u043c\u0435\u0440: \u041d\u043e\u0432\u043e\u0433\u043e\u0434\u043d\u044f\u044f \u0430\u043a\u0446\u0438\u044f \u2014 \u0441\u043a\u0438\u0434\u043a\u0438 \u0434\u043e 20%"
          />
        </div>

        <div>
          <div className="text-sm text-gray-600 mb-1">\u0421\u0441\u044b\u043b\u043a\u0430 (\u043d\u0435\u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u043e)</div>
          <input
            className="w-full border rounded-xl px-3 py-2"
            value={settings.bannerHref ?? ""}
            onChange={(e) =>
              setField("bannerHref", e.target.value.trim() || null)
            }
            placeholder="https://... \u0438\u043b\u0438 /shop"
          />
        </div>
      </div>
    </div>
  );
}
