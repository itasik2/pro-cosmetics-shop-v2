"use client";

import { useEffect, useState } from "react";

type StatusResponse = {
  mail: {
    configured: boolean;
    provider: "smtp" | "resend" | "none";
    recipient: string;
    sender: string;
    host: string | null;
  };
  pendingOrderNotifications: number;
  monitor: {
    latest: {
      isHealthy: boolean;
      responseTimeMs: number | null;
      error: string | null;
      createdAt: string;
    } | null;
    checksLast7Days: number;
    uptimePercent: number | null;
  };
};

function providerLabel(provider: StatusResponse["mail"]["provider"]) {
  if (provider === "smtp") return "Zoho SMTP";
  if (provider === "resend") return "Resend";
  return "не настроен";
}

export default function AdminNotificationsClient() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/notification-status", {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as StatusResponse & {
        error?: string;
      };
      if (!response.ok) {
        setMessage(`Не удалось проверить настройки: ${data.error || response.status}`);
        return;
      }
      setStatus(data);
    } catch (error) {
      setMessage(
        `Не удалось проверить настройки: ${error instanceof Error ? error.message : "failed"}`,
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function sendTest() {
    setSending(true);
    setMessage(null);

    try {
      const response = await fetch("/api/admin/notification-status", {
        method: "POST",
      });
      const data = (await response.json().catch(() => ({}))) as {
        delivery?: { status?: string; reason?: string };
      };
      if (!response.ok) {
        setMessage(
          data.delivery?.status === "skipped"
            ? "Почта ещё не активирована: добавьте пароль приложения Zoho в Vercel."
            : `Тестовое письмо не отправлено: ${data.delivery?.reason || response.status}`,
        );
        return;
      }

      setMessage("Тестовое письмо отправлено. Проверьте sales@procosmetics.kz.");
      await load();
    } catch (error) {
      setMessage(
        `Тестовое письмо не отправлено: ${error instanceof Error ? error.message : "failed"}`,
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="max-w-3xl space-y-4 rounded-2xl border p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold">Почта и мониторинг</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">
            Уведомления о новых заказах и еженедельные отчёты отправляются на
            sales@procosmetics.kz. Мониторинг ежедневно проверяет главную,
            каталог, базу данных и карту сайта.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
            onClick={load}
            disabled={loading || sending}
          >
            Обновить статус
          </button>
          <button
            type="button"
            className="btn disabled:cursor-not-allowed disabled:opacity-50"
            onClick={sendTest}
            disabled={loading || sending || !status?.mail.configured}
          >
            {sending ? "Отправка…" : "Отправить тест"}
          </button>
        </div>
      </div>

      {message ? (
        <div className="rounded-xl bg-gray-50 px-3 py-2 text-sm" role="status">
          {message}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-gray-500">Проверка настроек…</p>
      ) : status ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border bg-white p-4 text-sm">
            <div className="font-semibold">Уведомления о заказах</div>
            <div className="mt-3 space-y-1 text-gray-600">
              <p>
                Статус: {status.mail.configured ? "готово" : "нужен пароль приложения"}
              </p>
              <p>Сервис: {providerLabel(status.mail.provider)}</p>
              <p className="break-all">Получатель: {status.mail.recipient}</p>
              <p className="break-all">Отправитель: {status.mail.sender}</p>
              <p>
                Ожидают отправки: {status.pendingOrderNotifications}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-4 text-sm">
            <div className="font-semibold">Контроль сайта</div>
            <div className="mt-3 space-y-1 text-gray-600">
              <p>
                Последняя проверка:{" "}
                {status.monitor.latest
                  ? status.monitor.latest.isHealthy
                    ? "успешно"
                    : "обнаружена проблема"
                  : "ещё не выполнялась"}
              </p>
              {status.monitor.latest ? (
                <p>
                  {new Date(status.monitor.latest.createdAt).toLocaleString("ru-RU")}
                  {status.monitor.latest.responseTimeMs !== null
                    ? ` • ${status.monitor.latest.responseTimeMs} мс`
                    : ""}
                </p>
              ) : null}
              <p>Проверок за 7 дней: {status.monitor.checksLast7Days}</p>
              <p>
                Успешность: {status.monitor.uptimePercent ?? "нет данных"}
                {status.monitor.uptimePercent !== null ? " %" : ""}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {!loading && status && !status.mail.configured ? (
        <p className="text-xs leading-5 text-amber-800">
          Для активации нужен только секрет SMTP_PASSWORD_PROCOSMETICS в Vercel.
          Пароль приложения Zoho нельзя добавлять в код или отправлять в чат.
        </p>
      ) : null}
    </section>
  );
}
