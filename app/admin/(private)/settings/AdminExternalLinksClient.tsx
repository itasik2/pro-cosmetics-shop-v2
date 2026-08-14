"use client";

import { useEffect, useRef, useState } from "react";

type LinkKind = "SOCIAL" | "MARKETPLACE";

type StoredLink = {
  id: string;
  kind: LinkKind;
  label: string;
  url: string;
  isEnabled: boolean;
  sortOrder: number;
};

type EditableLink = StoredLink & {
  clientId: string;
  platform: string;
};

type PlatformOption = {
  value: string;
  label: string;
  custom?: boolean;
};

const PLATFORM_OPTIONS: Record<LinkKind, PlatformOption[]> = {
  SOCIAL: [
    { value: "instagram", label: "Instagram" },
    { value: "tiktok", label: "TikTok" },
    { value: "telegram", label: "Telegram" },
    { value: "youtube", label: "YouTube" },
    { value: "facebook", label: "Facebook" },
    { value: "whatsapp", label: "WhatsApp" },
    { value: "social-other", label: "Другая соцсеть", custom: true },
  ],
  MARKETPLACE: [
    { value: "kaspi", label: "Kaspi" },
    { value: "halyk-market", label: "Halyk Market" },
    { value: "wildberries", label: "Wildberries" },
    { value: "ozon", label: "Ozon" },
    { value: "fortemarket", label: "ForteMarket" },
    {
      value: "marketplace-other",
      label: "Другой маркетплейс",
      custom: true,
    },
  ],
};

function normalizePlatformName(value: string) {
  return value.toLocaleLowerCase("ru").replace(/[^a-zа-яё0-9]+/g, "");
}

function inferPlatform(kind: LinkKind, label: string) {
  const normalizedLabel = normalizePlatformName(label);
  const options = PLATFORM_OPTIONS[kind];
  if (!normalizedLabel) {
    return options.find((option) => option.custom)?.value || "";
  }
  const knownOption = options.find((option) => {
    if (option.custom) return false;
    const normalizedOption = normalizePlatformName(option.label);
    return (
      normalizedLabel === normalizedOption ||
      normalizedLabel.includes(normalizedOption) ||
      normalizedOption.includes(normalizedLabel)
    );
  });

  return knownOption?.value || options.find((option) => option.custom)?.value || "";
}

function createEditableLink(
  clientId: string,
  kind: LinkKind = "SOCIAL",
  sortOrder = 0,
): EditableLink {
  const platform = PLATFORM_OPTIONS[kind][0];

  return {
    id: "",
    clientId,
    kind,
    platform: platform.value,
    label: platform.label,
    url: "",
    isEnabled: false,
    sortOrder,
  };
}

function toEditable(link: StoredLink): EditableLink {
  return {
    ...link,
    clientId: link.id,
    platform: inferPlatform(link.kind, link.label),
  };
}

function defaultEditableLinks() {
  return [createEditableLink("default-instagram")];
}

function kindLabel(kind: LinkKind) {
  return kind === "SOCIAL" ? "Социальная сеть" : "Маркетплейс";
}

export default function AdminExternalLinksClient() {
  const [links, setLinks] = useState<EditableLink[]>(defaultEditableLinks);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const nextClientId = useRef(0);

  function setLoadedLinks(rows: StoredLink[]) {
    const meaningfulRows = rows.filter(
      (row) => row.isEnabled || Boolean(row.url.trim()),
    );
    setLinks(
      meaningfulRows.length > 0
        ? meaningfulRows.map(toEditable)
        : defaultEditableLinks(),
    );
  }

  async function load() {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/external-links", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as {
        links?: StoredLink[];
        error?: string;
      };

      if (!response.ok) {
        setMessage(`Ошибка загрузки ссылок: ${data.error || response.status}`);
        return;
      }

      setLoadedLinks(Array.isArray(data.links) ? data.links : []);
    } catch (error: unknown) {
      setMessage(
        `Ошибка загрузки ссылок: ${error instanceof Error ? error.message : "failed"}`,
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function updateLink(index: number, patch: Partial<EditableLink>) {
    setLinks((current) =>
      current.map((link, currentIndex) =>
        currentIndex === index ? { ...link, ...patch } : link,
      ),
    );
  }

  function moveLink(index: number, direction: -1 | 1) {
    setLinks((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;

      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  function addLink() {
    nextClientId.current += 1;
    setLinks((current) => [
      ...current,
      createEditableLink(
        `new-${Date.now()}-${nextClientId.current}`,
        "SOCIAL",
        current.length * 10,
      ),
    ]);
  }

  async function save() {
    const meaningfulLinks = links.filter(
      (link) => link.isEnabled || Boolean(link.url.trim()),
    );
    const linksToSave = meaningfulLinks.length
      ? meaningfulLinks
      : [createEditableLink("empty")];

    const emptyLabelIndex = linksToSave.findIndex((link) => !link.label.trim());
    if (emptyLabelIndex >= 0) {
      setMessage(`Укажите название у ссылки №${emptyLabelIndex + 1}.`);
      return;
    }

    const enabledWithoutUrl = linksToSave.find(
      (link) => link.isEnabled && !link.url.trim(),
    );
    if (enabledWithoutUrl) {
      setMessage(`Для включённой ссылки «${enabledWithoutUrl.label}» нужен адрес.`);
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/external-links", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          links: linksToSave.map((link) => ({
            id: link.id || undefined,
            kind: link.kind,
            label: link.label.trim(),
            url: link.url.trim(),
            isEnabled: link.isEnabled,
          })),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        links?: StoredLink[];
        error?: string;
      };

      if (!response.ok) {
        setMessage(
          data.error === "validation"
            ? "Проверьте адреса: разрешены только полные ссылки https://… или http://…."
            : `Ошибка сохранения ссылок: ${data.error || response.status}`,
        );
        return;
      }

      setLoadedLinks(Array.isArray(data.links) ? data.links : []);
      setMessage("Ссылки сохранены. Активные кнопки уже доступны на сайте.");
    } catch (error: unknown) {
      setMessage(
        `Ошибка сохранения ссылок: ${error instanceof Error ? error.message : "failed"}`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="max-w-3xl space-y-5 rounded-2xl border p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold">Социальные сети и маркетплейсы</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
            Выберите тип и площадку, вставьте полную ссылку и включите показ.
            Дополнительная форма появляется только по кнопке «＋ Добавить ещё».
            Порядок форм совпадает с порядком кнопок на сайте.
          </p>
        </div>
        <button
          type="button"
          className="btn shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={save}
          disabled={busy || loading}
        >
          {busy ? "Сохранение…" : "Сохранить ссылки"}
        </button>
      </div>

      {message ? (
        <div className="rounded-xl bg-gray-50 px-3 py-2 text-sm" role="status">
          {message}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-gray-500">Загрузка ссылок…</div>
      ) : (
        <div className="space-y-3">
          {links.map((link, index) => (
            <div
              key={link.clientId}
              className="grid gap-3 rounded-2xl border bg-white p-3 sm:grid-cols-[170px_minmax(0,1fr)_auto]"
            >
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-600">
                  Тип ссылки
                  <select
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-normal text-gray-900"
                    value={link.kind}
                    onChange={(event) => {
                      const kind = event.target.value as LinkKind;
                      const platform = PLATFORM_OPTIONS[kind][0];
                      updateLink(index, {
                        kind,
                        platform: platform.value,
                        label: platform.label,
                        url: "",
                        isEnabled: false,
                      });
                    }}
                  >
                    <option value="SOCIAL">Соцсеть</option>
                    <option value="MARKETPLACE">Маркетплейс</option>
                  </select>
                </label>
                <label className="block text-xs font-semibold text-gray-600">
                  Площадка
                  <select
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-normal text-gray-900"
                    value={link.platform}
                    onChange={(event) => {
                      const platform = PLATFORM_OPTIONS[link.kind].find(
                        (option) => option.value === event.target.value,
                      );
                      if (!platform) return;
                      updateLink(index, {
                        platform: platform.value,
                        label: platform.custom ? "" : platform.label,
                        url: "",
                        isEnabled: false,
                      });
                    }}
                  >
                    {PLATFORM_OPTIONS[link.kind].map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid min-w-0 gap-2">
                {PLATFORM_OPTIONS[link.kind].find(
                  (option) => option.value === link.platform,
                )?.custom ? (
                  <label className="block text-xs font-semibold text-gray-600">
                    Название кнопки
                    <input
                      className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-normal text-gray-900"
                      value={link.label}
                      maxLength={60}
                      onChange={(event) =>
                        updateLink(index, { label: event.target.value })
                      }
                      placeholder="Например: Магазин партнёра"
                    />
                  </label>
                ) : null}
                <label className="block text-xs font-semibold text-gray-600">
                  {link.kind === "MARKETPLACE"
                    ? "Ссылка на каталог магазина"
                    : "Ссылка на профиль"}
                  <input
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-normal text-gray-900"
                    type="url"
                    inputMode="url"
                    value={link.url}
                    maxLength={2048}
                    onChange={(event) => {
                      const url = event.target.value;
                      updateLink(index, {
                        url,
                        ...(url.trim() ? {} : { isEnabled: false }),
                      });
                    }}
                    placeholder="https://…"
                  />
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={link.isEnabled}
                    disabled={!link.url.trim()}
                    onChange={(event) =>
                      updateLink(index, { isEnabled: event.target.checked })
                    }
                  />
                  Показывать кнопку на сайте
                </label>
              </div>

              <div className="flex items-center gap-1 sm:flex-col sm:justify-center">
                <button
                  type="button"
                  className="btn-secondary h-8 w-8 p-0 disabled:opacity-40"
                  onClick={() => moveLink(index, -1)}
                  disabled={index === 0}
                  aria-label={`Поднять «${link.label}»`}
                  title="Поднять"
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn-secondary h-8 w-8 p-0 disabled:opacity-40"
                  onClick={() => moveLink(index, 1)}
                  disabled={index === links.length - 1}
                  aria-label={`Опустить «${link.label}»`}
                  title="Опустить"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center rounded-full border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() =>
                    setLinks((current) =>
                      current.length > 1
                        ? current.filter((_, currentIndex) => currentIndex !== index)
                        : current,
                    )
                  }
                  disabled={links.length === 1}
                  aria-label={`Удалить «${link.label}»`}
                >
                  Удалить
                </button>
              </div>

              <p className="text-xs text-gray-500 sm:col-span-3">
                {kindLabel(link.kind)} ·{" "}
                {link.isEnabled
                  ? "кнопка будет показана после сохранения"
                  : "кнопка скрыта"}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={addLink}>
          <span aria-hidden="true" className="text-lg leading-none">
            ＋
          </span>{" "}
          Добавить ещё
        </button>
      </div>
    </section>
  );
}
