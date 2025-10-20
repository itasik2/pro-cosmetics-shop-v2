"use client";
import { useEffect, useState } from "react";

const emptyForm = { name: "", brand: "", description: "", price: 0, image: "/seed/cleanser.jpg", category: "", stock: 0 };

export default function AdminProducts() {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/products");
    if (res.ok) setItems(await res.json());
  }
  useEffect(() => { load(); }, []);

  async function save() {
    const body = { ...form, price: Number(form.price), stock: Number(form.stock) };
    const res = editing
      ? await fetch(`/api/products/${editing}`, { method: "PUT", body: JSON.stringify(body) })
      : await fetch(`/api/products`, { method: "POST", body: JSON.stringify(body) });
    if (res.ok) { setForm(emptyForm); setEditing(null); load(); }
  }

  async function remove(id: string) {
    if (!confirm("Удалить товар?")) return;
    const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  return (
    <div className="grid md:grid-cols-2 gap-8">
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">{editing ? "Редактировать" : "Добавить"} товар</h2>
        <div className="card space-y-3">
          {["name","brand","description","image","category","price","stock"].map((k)=>(
            <div key={k} className="space-y-1">
              <label className="block text-sm text-gray-600">{k}</label>
              <input className="w-full border rounded-xl px-3 py-2" value={form[k] ?? ""} onChange={(e)=>setForm({...form,[k]: e.target.value})} />
            </div>
          ))}
          <button className="btn" onClick={save}>Сохранить</button>
        </div>
      </div>
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Товары</h2>
        <div className="grid grid-cols-1 gap-3">
          {items.map((p)=>(
            <div key={p.id} className="card flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.image} alt={p.name} className="w-16 h-16 object-cover rounded-lg" />
                <div>
                  <div className="font-semibold">{p.name}</div>
                  <div className="text-sm text-gray-500">{(p.price/100).toFixed(2)} ₸ • {p.stock} шт</div>
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn" onClick={()=>{ setEditing(p.id); setForm(p); }}>Ред.</button>
                <button className="btn" onClick={()=>remove(p.id)}>Удалить</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
