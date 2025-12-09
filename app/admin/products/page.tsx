"use client";

export const dynamic = "force-dynamic";
export const revalidate = 0;



import { useEffect, useState } from "react";

type Product = {
  id: string;
  name: string;
  brand: string;
  description: string;
  image: string;
  category: string;
  price: number; // minor
  stock: number;
};

const emptyForm = {
  name: "",
  brand: "",
  description: "",
  image: "/seed/cleanser.jpg",
  category: "",
  price: "",
  stock: "",
};

export default function AdminProducts() {
  const [items, setItems] = useState<Product[]>([]);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch("/api/products", { cache: "no-store" });
    if (res.ok) setItems(await res.json());
  }
  useEffect(() => { load(); }, []);

  function setField<K extends keyof typeof emptyForm>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function toMinor(priceMajors: string) {
    const n = Number(priceMajors);
    if (!isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
  }

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setMsg(null);
    const body = {
      name: form.name.trim(),
      brand: form.brand.trim(),
      description: form.description.trim(),
      image: form.image.trim(),
      category: form.category.trim(),
      price: toMinor(form.price),
      stock: Math.max(0, Number(form.stock) | 0),
    };
    const url = editing ? `/api/products/${editing}` : `/api/products`;
    const method = editing ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({} as any));
    setBusy(false);
    if (res.ok) {
      setMsg(editing ? "Обновлено" : "Добавлено");
      setForm(emptyForm);
      setEditing(null);
      load();
    } else {
      setMsg(`Ошибка: ${data?.error || res.status}`);
    }
  }

  async function remove(id: string) {
    if (!confirm("Удалить товар?")) return;
    const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  function edit(p: Product) {
    setEditing(p.id);
    setForm({
      name: p.name,
      brand: p.brand,
      description: p.description,
      image: p.image,
      category: p.category,
      price: (p.price / 100).toString(),
      stock: String(p.stock ?? 0),
    });
  }

  return (
    <div className="grid md:grid-cols-2 gap-8">
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">{editing ? "Редактировать" : "Добавить"} товар</h2>
        <form className="space-y-3" onSubmit={save}>
          <Field label="Название"><input required className="w-full border rounded-xl px-3 py-2" value={form.name} onChange={e=>setField("name", e.target.value)} /></Field>
          <Field label="Бренд"><input required className="w-full border rounded-xl px-3 py-2" value={form.brand} onChange={e=>setField("brand", e.target.value)} /></Field>
          <Field label="Описание"><textarea required rows={3} className="w-full border rounded-xl px-3 py-2" value={form.description} onChange={e=>setField("description", e.target.value)} /></Field>
          <Field label="URL изображения"><input required className="w-full border rounded-xl px-3 py-2" value={form.image} onChange={e=>setField("image", e.target.value)} /></Field>
          <Field label="Категория"><input required className="w-full border rounded-xl px-3 py-2" value={form.category} onChange={e=>setField("category", e.target.value)} /></Field>
          <Field label="Цена (в тенге)"><input required type="number" min={0} step="0.01" className="w-full border rounded-xl px-3 py-2" value={form.price} onChange={e=>setField("price", e.target.value)} /></Field>
          <Field label="Остаток, шт"><input required type="number" min={0} step="1" className="w-full border rounded-xl px-3 py-2" value={form.stock} onChange={e=>setField("stock", e.target.value)} /></Field>
          <div className="flex items-center gap-3">
            <button className="px-4 py-2 rounded bg-black text-white disabled:opacity-50" type="submit" disabled={busy}>{busy ? "Сохранение…" : "Сохранить"}</button>
            {editing && <button type="button" className="px-4 py-2 rounded border" onClick={()=>{ setEditing(null); setForm(emptyForm); }}>Отмена</button>}
          </div>
          {msg && <div className="text-sm">{msg}</div>}
          <p className="text-xs text-gray-500">Цена вводится в тенге; в базе хранится в тиынах.</p>
        </form>
      </div>

      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Товары</h2>
        <div className="grid grid-cols-1 gap-3">
          {items.map((p)=>(
            <div key={p.id} className="rounded-2xl border p-3 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.image} alt={p.name} className="w-16 h-16 object-cover rounded-lg" />
                <div>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-sm text-gray-500">{p.brand} • {(p.price/100).toFixed(2)} ₸ • {p.stock} шт</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn" onClick={()=>edit(p)}>Ред.</button>
                <button className="btn" onClick={()=>remove(p.id)}>Удалить</button>
              </div>
            </div>
          ))}
          {items.length === 0 && <div className="text-sm text-gray-500">Пока пусто</div>}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-sm text-gray-600">{label}</label>
      {children}
    </div>
  );
}
