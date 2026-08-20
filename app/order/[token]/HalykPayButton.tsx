"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

declare global {
  interface Window {
    halyk?: {
      pay: (paymentObject: Record<string, unknown>) => void;
    };
  }
}

type SessionResponse = {
  ok?: boolean;
  status?: string;
  mode?: "test" | "production";
  scriptUrl?: string;
  paymentObject?: Record<string, unknown>;
  message?: string;
  error?: string;
};

function loadHalykScript(src: string) {
  if (window.halyk?.pay) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-halyk-epay="true"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Не удалось загрузить платёжную форму Halyk.")),
        { once: true },
      );
      if (window.halyk?.pay) resolve();
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.halykEpay = "true";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Не удалось загрузить платёжную форму Halyk."));
    document.head.appendChild(script);
  });
}

export default function HalykPayButton({
  token,
  amount,
}: {
  token: string;
  amount: number;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");

  async function startPayment() {
    if (loading) return;
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(token)}/payments/halyk`,
        { method: "POST", cache: "no-store" },
      );
      const data = (await response.json().catch(() => ({}))) as SessionResponse;

      if (!response.ok) {
        throw new Error(data.message || "Не удалось начать оплату через Halyk.");
      }

      if (data.status === "PAID" || data.status === "REFUNDED") {
        setMessage("Оплата уже подтверждена.");
        router.refresh();
        return;
      }

      if (!data.scriptUrl || !data.paymentObject) {
        throw new Error("Halyk не вернул данные платёжной формы.");
      }

      await loadHalykScript(data.scriptUrl);
      if (!window.halyk?.pay) {
        throw new Error("Платёжная форма Halyk не инициализировалась.");
      }

      window.halyk.pay(data.paymentObject);
      if (data.mode === "test") {
        setMessage("Открыта тестовая платёжная форма Halyk ePay.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Не удалось открыть Halyk ePay.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function checkStatus() {
    if (checking) return;
    setChecking(true);
    setMessage("");

    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(token)}/payments/halyk`,
        { method: "GET", cache: "no-store" },
      );
      const data = (await response.json().catch(() => ({}))) as SessionResponse;
      if (!response.ok) {
        throw new Error(data.message || "Не удалось проверить оплату.");
      }

      if (data.status === "PAID" || data.status === "REFUNDED") {
        setMessage("Оплата подтверждена.");
        router.refresh();
      } else if (data.status === "PENDING") {
        setMessage("Платёж ещё обрабатывается банком.");
      } else {
        setMessage("Оплата пока не найдена.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Не удалось проверить оплату.",
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={startPayment}
        disabled={loading}
        className="inline-flex w-full items-center justify-center rounded-xl bg-emerald-700 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-800 disabled:opacity-60 sm:w-auto"
      >
        {loading
          ? "Открываем Halyk ePay…"
          : `Оплатить картой ${amount.toLocaleString("ru-RU")} ₸`}
      </button>

      <button
        type="button"
        onClick={checkStatus}
        disabled={checking}
        className="ml-0 inline-flex rounded-xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-gray-50 disabled:opacity-60 sm:ml-2"
      >
        {checking ? "Проверяем…" : "Проверить статус оплаты"}
      </button>

      {message ? <div className="text-sm text-gray-700">{message}</div> : null}
    </div>
  );
}
