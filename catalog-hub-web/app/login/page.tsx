"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
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
      setError(body?.error === "invalid_password" ? "Неверный пароль" : "Вход не настроен");
      setLoading(false);
      return;
    }

    router.replace(params.get("next") || "/");
    router.refresh();
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
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
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
          />
        </label>

        {error && <div className="error">{error}</div>}
        {params.get("error") === "session_not_configured" && (
          <div className="error">CATALOG_HUB_UI_SESSION_TOKEN не настроен.</div>
        )}

        <button className="button primary login-button" disabled={loading || !password}>
          {loading ? "Вход…" : "Войти"}
        </button>
      </form>
    </main>
  );
}
