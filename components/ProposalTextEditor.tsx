"use client";

import { useState } from "react";
import {
  proposalText,
  type EditableProposal,
} from "@/lib/enrichment/proposalText";
import { publishProposalChange } from "@/lib/enrichment/proposalChanges";

const fields = [
  { key: "title", label: "Заголовок", rows: 2, maxLength: 500 },
  {
    key: "shortDescription",
    label: "Краткое описание",
    rows: 4,
    maxLength: 280,
  },
  { key: "description", label: "Описание", rows: 12, maxLength: 30000 },
  { key: "application", label: "Способ применения", rows: 5, maxLength: 12000 },
  {
    key: "ingredients",
    label: "Состав и активные компоненты",
    rows: 5,
    maxLength: 16000,
  },
] as const;

export function ProposalTextEditor({
  proposal,
  disabled,
  onEditingChange,
}: {
  proposal: EditableProposal;
  disabled?: boolean;
  onEditingChange: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => proposalText(proposal));
  const [version, setVersion] = useState(proposal.textVersion);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const text = proposalText(proposal);

  function toggle(value: boolean) {
    setEditing(value);
    onEditingChange(value);
    setMessage("");
    if (value) {
      setDraft(text);
      setVersion(proposal.textVersion);
    }
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(
        "/api/admin/enrichment/proposals/" + encodeURIComponent(proposal.id),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            version,
            ...Object.fromEntries(
              fields.map(({ key }) => [key, draft[key] || ""]),
            ),
          }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(data.message || "Не удалось сохранить текст.");
      publishProposalChange({
        id: proposal.id,
        status: "PENDING",
        text: data.proposal,
      });
      toggle(false);
      setMessage(
        "Текст сохранён в предложении. Одобрите его, чтобы применить к товару.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Не удалось сохранить текст.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3" aria-label="Текст предложения">
      <div className="flex flex-wrap items-center gap-2">
        {!editing ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => toggle(true)}
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
          >
            Редактировать текст
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={disabled || saving}
              onClick={() => void save()}
              className="rounded-lg bg-black px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              {saving ? "Сохранение…" : "Сохранить текст"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => toggle(false)}
              className="rounded-lg border px-3 py-2 text-sm"
            >
              Отмена
            </button>
            <p className="text-xs text-gray-500">
              Сначала сохраните правки, затем одобрите текст.
            </p>
          </>
        )}
      </div>
      {fields.map(({ key, label, rows, maxLength }) => (
        <label key={key} className="block rounded-xl border p-3">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500">
            {label}
          </span>
          {editing ? (
            <textarea
              value={draft[key] || ""}
              rows={rows}
              maxLength={maxLength}
              disabled={disabled || saving}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  [key]: event.target.value,
                }))
              }
              className="w-full resize-y rounded-lg border bg-white p-2 text-sm"
            />
          ) : (
            <span className="block whitespace-pre-line text-sm text-gray-800">
              {text[key] || "—"}
            </span>
          )}
        </label>
      ))}
      {message && (
        <p role="status" className="rounded-lg border bg-gray-50 p-2 text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
