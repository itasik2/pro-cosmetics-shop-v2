"use client";

import { useState, type FormEvent } from "react";

export default function PaymentReportForm({
  token,
  paymentStatus,
}: {
  token: string;
  paymentStatus: string;
}) {
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    paymentStatus === "PENDING" ? "sent" : "idle",
  );
  const [error, setError] = useState("");

  if (paymentStatus === "PENDING" || state === "sent") {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        Мы получили сообщение об оплате. Менеджер проверит перевод и обновит статус заказа.
      </div>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setError("");

    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(token)}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.message || data.error || "Не удалось отправить сообщение");
      }
      setState("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось отправить сообщение");
      setState("error");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block space-y-1 text-sm">
        <span className="text-gray-600">Комментарий (необязательно)</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="min-h-20 w-full rounded-xl border px-3 py-2"
          placeholder="Например: перевод с карты ****1234"
          maxLength={500}
        />
      </label>
      {error ? <div className="text-sm text-red-700">{error}</div> : null}
      <button
        type="submit"
        disabled={state === "sending"}
        className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {state === "sending" ? "Отправляем…" : "Я оплатил"}
      </button>
    </form>
  );
}
