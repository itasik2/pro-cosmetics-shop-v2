"use client";
import { useEffect, useState } from "react";

const empty = { title: "", slug: "", category: "новости", image: "/seed/post1.jpg", content: "" };

export default function AdminPosts() {
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState<any>(empty);
  const [editing, setEditing] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/posts");
    if (res.ok) setItems(await res.json());
  }
  useEffect(()=>{ load(); }, []);

  async function save() {
    const body = { ...form };
    const res = editing
      ? await fetch(`/api/posts/${editing}`, { method: "PUT", body: JSON.stringify(body) })
      : await fetch(`/api/posts`, { method: "POST", body: JSON.stringify(body) });
    if (res.ok) { setForm(empty); setEditing(null); load(); }
  }

  async function remove(id: string) {
    if (!confirm("Удалить материал?")) return;
    const res = await fetch(`/api/posts/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  return (
    <div className="grid md:grid-cols-2 gap-8">
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">{editing ? "Редактировать материал" : "Новая запись"}</h2>
        <div className="card space-y-3">
          {["title","slug","category","image"].map((k)=>(
            <div key={k} className="space-y-1">
              <label className="block text-sm text-gray-600">{k}</label>
              <input className="w-full border rounded-xl px-3 py-2" value={form[k] ?? ""} onChange={(e)=>setForm({...form,[k]: e.target.value})} />
            </div>
          ))}
          <div className="space-y-1">
            <label className="block text-sm text-gray-600">content</label>
            <textarea rows={8} className="w-full border rounded-xl px-3 py-2" value={form.content} onChange={(e)=>setForm({...form, content: e.target.value})} />
          </div>
          <button className="btn" onClick={save}>Сохранить</button>
        </div>
      </div>
      <div className="space-y-3">
        <h2 className="text-xl font-semibold">Материалы</h2>
        <div className="grid grid-cols-1 gap-3">
          {items.map((p)=>(
            <div key={p.id} className="card flex items-center justify-between gap-4">
              <div>
                <div className="font-semibold">{p.title}</div>
                <div className="text-sm text-gray-500">{p.category} • /blog/{p.slug}</div>
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
// app/admin/posts/page.tsx
