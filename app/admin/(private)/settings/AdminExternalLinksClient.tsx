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
};

const DEFAULT_LINKS: Array<Omit<StoredLink, "id"> & { id: string }> = [
  {
    id: "default-instagram",
    kind: "SOCIAL",
    label: "Instagram",
    url: "",
    isEnabled: false,
    sortOrder: 0,
  },
  {
    id: "default-tiktok",
    kind: "SOCIAL",
    label: "TikTok",
    url: "",
    isEnabled: false,
    sortOrder: 10,
  },
  {
    id: "default-telegram",
    kind: "SOCIAL",
    label: "Telegram",
    url: "",
    isEnabled: false,
    sortOrder: 20,
  },
  {
    id: "default-kaspi",
    kind: "MARKETPLACE",
    label: "Kaspi Магазин",
    url: "",
    isEnabled: false,
    sortOrder: 30,
  },
  {
    id: "default-halyk",
    kind: "MARKETPLACE",
    label: "Halyk Market",
    url: "",
    isEnabled: false,
    sortOrder: 40,
  },
];

function toEditable(link: StoredLink): EditableLink {
  return { ...link, clientId: link.id };
}

function defaultEditableLinks() {
  return DEFAULT_LINKS.map(toEditable);
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
    setLinks(rows.length > 0 ? rows.map(toEditable) : defaultEditableLinks());
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

  function addLink(kind: LinkKind) {
    nextClientId.current += 1;
    setLinks((current) => [
      ...current,
      {
        id: "",
        clientId: `new-${Date.now()}-${nextClientId.current}`,
        kind,
        label: kind === "SOCIAL" ? "Новая соцсеть" : "Новый маркетплейс",
        url: "",
        isEnabled: false,
        sortOrder: current.length * 10,
      },
    ]);
  }

  async function save() {
    if (links.length === 0) {
      setMessage("Добавьте хотя бы одну позицию. Ненужную ссылку можно оставить выключенной.");
      return;
    }

    const emptyLabelIndex = links.findIndex((link) => !link.label.trim());
    if (emptyLabelIndex >= 0) {
      setMessage(`Укажите название у ссылки №${emptyLabelIndex + 1}.`);
      return;
    }

    const enabledWithoutUrl = links.find((link) => link.isEnabled && !link.url.trim());
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
          links: links.map((link) => ({
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
            Добавьте полную ссылку, включите её и сохраните. Пустые и выключенные
            позиции посетителям не показываются. Порядок здесь совпадает с порядком
            кнопок на сайте.
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
              className="grid gap-3 rounded-2xl border bg-white p-3 sm:grid-cols-[140px_minmax(0,1fr)_auto]"
            >
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-gray-600">
                  Раздел
                  <select
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-normal text-gray-900"
                    value={link.kind}
                    onChange={(event) =>
                      updateLink(index, { kind: event.target.value as LinkKind })
                    }
                  >
                    <option value="SOCIAL">Соцсеть</option>
                    <option value="MARKETPLACE">Маркетплейс</option>
                  </select>
                </label>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={link.isEnabled}
                    onChange={(event) =>
                      updateLink(index, { isEnabled: event.target.checked })
                    }
                  />
                  Показывать
                </label>
              </div>

              <div className="grid min-w-0 gap-2">
                <label className="block text-xs font-semibold text-gray-600">
                  Название кнопки
                  <input
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-normal text-gray-900"
                    value={link.label}
                    maxLength={60}
                    onChange={(event) => updateLink(index, { label: event.target.value })}
                    placeholder="Например: Instagram"
                  />
                </label>
                <label className="block text-xs font-semibold text-gray-600">
                  Полная ссылка
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
                  className="inline-flex h-8 items-center justify-center rounded-full border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50"
                  onClick={() =>
                    setLinks((current) => current.filter((_, currentIndex) => currentIndex !== index))
                  }
                  aria-label={`Удалить «${link.label}»`}
                >
                  Удалить
                </button>
              </div>

              <p className="text-xs text-gray-500 sm:col-span-3">
                {kindLabel(link.kind)} · {link.isEnabled ? "будет показана после сохранения" : "скрыта"}
              </p>
            </div>
          ))}

          {links.length === 0 ? (
            <div className="rounded-xl border border-dashed p-4 text-sm text-gray-500">
              Ссылок пока нет. Добавьте соцсеть или маркетплейс кнопками ниже.
            </div>
          ) : null}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={() => addLink("SOCIAL")}>
          Добавить соцсеть
        </button>
        <button type="button" className="btn-secondary" onClick={() => addLink("MARKETPLACE")}>
          Добавить маркетплейс
        </button>
      </div>
    </section>
  );
}
