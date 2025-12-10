"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const res = await signIn("credentials", {
      email, password,
      redirect: true,
      callbackUrl: "/admin/products", // куда перейти после входа
    });
    // при redirect:true управление перейдёт на callbackUrl/ошибку
    setBusy(false);
  }

  return (
    <div className="max-w-sm mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">Вход в админ-панель</h1>
      <form className="space-y-3" onSubmit={onSubmit}>
        <input className="w-full border rounded-xl px-3 py-2" type="email"
               placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} required />
        <input className="w-full border rounded-xl px-3 py-2" type="password"
               placeholder="Пароль" value={password} onChange={e=>setPassword(e.target.value)} required />
        <button className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
                type="submit" disabled={busy}>
          {busy ? "Входим…" : "Войти"}
        </button>
      </form>
      {err && <div className="text-sm text-red-600">{err}</div>}
    </div>
  );
}
