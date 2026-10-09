"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginShell loading />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    const response = await fetch("/api/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(
        body?.error === "invalid_password"
          ? "Неверный пароль"
          : "Вход не настроен",
      );
      setLoading(false);
      return;
    }

    router.replace(params.get("next") || "/");
    router.refresh();
  }

  return (
    <LoginShell
      password={password}
      error={error}
      loading={loading}
      configError={params.get("error") === "session_not_configured"}
      onPassword={setPassword}
      onSubmit={submit}
    />
  );
}

function LoginShell({
  password = "",
  error = "",
  loading = false,
  configError = false,
  onPassword,
  onSubmit,
}: {
  password?: string;
  error?: string;
  loading?: boolean;
  configError?: boolean;
  onPassword?: (value: string) => void;
  onSubmit?: (event: FormEvent) => void;
}) {
  return (
    <main className="login-page">
      <form className="login-card" onSubmit={onSubmit}>
        <div className="brand-mark login-mark">CH</div>
        <span className="eyebrow">CATALOG OPERATIONS</span>
        <h1>Catalog Hub</h1>
        <p>Управление Master Card, AI, медиа, ценами и остатками.</p>

        <label>
          <span>Пароль</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => onPassword?.(event.target.value)}
            autoFocus
            disabled={!onPassword}
          />
        </label>

        {error && <div className="error">{error}</div>}
        {configError && (
          <div className="error">
            CATALOG_HUB_UI_SESSION_TOKEN не настроен.
          </div>
        )}

        <button
          className="button primary login-button"
          disabled={loading || !password || !onSubmit}
        >
          {loading ? "Вход…" : "Войти"}
        </button>
      </form>
    </main>
  );
}
