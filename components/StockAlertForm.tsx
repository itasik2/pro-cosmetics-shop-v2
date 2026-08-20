"use client";

import { useEffect, useState } from "react";

type Channel = "EMAIL" | "TELEGRAM" | "WHATSAPP";

export default function StockAlertForm({
  productId,
  variantId,
  variantLabel,
}: {
  productId: string;
  variantId?: string | null;
  variantLabel?: string | null;
}) {
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<Channel>("EMAIL");
  const [contact, setContact] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [connectUrl, setConnectUrl] = useState("");

  useEffect(() => {
    setMessage("");
    setConnectUrl("");
  }, [variantId]);

  const placeholder =
    channel === "EMAIL"
      ? "you@email.com"
      : "+7 ...";

  async function submit() {
    if (loading) return;
    setLoading(true);
    setMessage("");
    setConnectUrl("");

    try {
      const response = await fetch("/api/stock-alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          variantId: variantId || null,
          customerName: name.trim(),
          channel,
          contact: contact.trim(),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        message?: string;
        telegramConnectUrl?: string;
      };
      if (!response.ok) throw new Error(data.message || "Не удалось сохранить заявку.");

      setMessage(data.message || "Заявка сохранена.");
      setConnectUrl(String(data.telegramConnectUrl || ""));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить заявку.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div id="stock-alert" className="mt-4 space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div>
        <div className="font-semibold">Заказать при поступлении</div>
        <div className="mt-1 text-sm text-amber-900">
          {variantLabel ? `Вариант «${variantLabel}» сейчас отсутствует. ` : "Товара сейчас нет в наличии. "}
          Оставьте контакт, и мы сообщим, когда он появится. Оплата сейчас не требуется.
        </div>
      </div>

      <input
        className="w-full rounded-xl border bg-white px-3 py-2 text-sm"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Имя (необязательно)"
        maxLength={80}
      />

      <div className="flex flex-wrap gap-4 text-sm">
        {(["EMAIL", "TELEGRAM", "WHATSAPP"] as Channel[]).map((value) => (
          <label key={value} className="inline-flex items-center gap-2">
            <input
              type="radio"
              checked={channel === value}
              onChange={() => {
                setChannel(value);
                setContact("");
                setMessage("");
                setConnectUrl("");
              }}
            />
            {value === "EMAIL" ? "Email" : value === "TELEGRAM" ? "Telegram" : "WhatsApp"}
          </label>
        ))}
      </div>

      {channel === "TELEGRAM" ? (
        <div className="text-xs text-amber-900">
          Укажите номер телефона, привязанный к Telegram. После сохранения откройте бота и нажмите «Поделиться номером телефона» для подтверждения.
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type={channel === "EMAIL" ? "email" : "tel"}
          className="min-w-0 flex-1 rounded-xl border bg-white px-3 py-2 text-sm"
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          placeholder={placeholder}
          maxLength={160}
        />
        <button
          type="button"
          onClick={submit}
          disabled={loading || contact.trim().length < 2}
          className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Сохраняем…" : "Уведомить о поступлении"}
        </button>
      </div>

      {message ? <div className="text-sm text-gray-700">{message}</div> : null}

      {connectUrl ? (
        <a
          href={connectUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
        >
          Подключить Telegram
        </a>
      ) : null}
    </div>
  );
}