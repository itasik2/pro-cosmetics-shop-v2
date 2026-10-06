"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import AddToCartButton from "@/components/AddToCartButton";
import { CATEGORY_OPTIONS, CARE_OPTIONS, parseBudget } from "@/lib/catalogFilters";
import { SITE_WHATSAPP_URL } from "@/lib/siteConfig";
import type { ConsultantRecommendation } from "@/lib/consultantCatalog";

type ProductContext = { id: string; slug: string; name: string; price: number | null; volume: string; category: string; brand?: { name: string } | null };
type Message = { id: number; role: "user" | "assistant"; text: string; recommendations?: ConsultantRecommendation[]; mode?: string };
const examples = ["Крем для чувствительной кожи до 10 000 ₸", "Нужно увлажнение после умывания", "Помоги выбрать средство для очищения"];

export default function AskClient() {
  const params = useSearchParams();
  const productId = params.get("productId") || "";
  const care = CARE_OPTIONS.find((option) => option.slug === params.get("care"));
  const category = CATEGORY_OPTIONS.find((option) => option.slug === params.get("category"));
  const budget = parseBudget(params.get("maxPrice") || "");
  const initialQuestion = [params.get("q")?.slice(0, 500) || "", care?.label, category?.label, budget ? `Бюджет до ${budget} ₸` : ""].filter(Boolean).join(". ");
  const [question, setQuestion] = useState(initialQuestion);
  const [product, setProduct] = useState<ProductContext | null>(null);
  const [productLoading, setProductLoading] = useState(!!productId);
  const [productError, setProductError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const nextId = useRef(0);
  const answerRef = useRef<HTMLDivElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current?.abort();
    setLoading(false); setMessages([]); setProduct(null); setProductError(false);
    setProductLoading(!!productId); setQuestion(initialQuestion);
    if (productId) fetch(`/api/ask/product/${encodeURIComponent(productId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("product_unavailable");
        const data = await response.json() as ProductContext;
        if (!controller.signal.aborted) { setProduct(data); setQuestion(initialQuestion || "Как применять это средство?"); }
      }).catch(() => { if (!controller.signal.aborted) setProductError(true); })
      .finally(() => { if (!controller.signal.aborted) setProductLoading(false); });
    return () => { controller.abort(); requestRef.current?.abort(); };
  }, [productId, initialQuestion]);

  useEffect(() => {
    if (messages.at(-1)?.role === "assistant") {
      answerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      answerRef.current?.focus({ preventScroll: true });
    }
  }, [messages]);

  async function ask() {
    const query = question.trim();
    if (loading || productLoading || query.length < 3 || query.length > 2000) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const history = messages.slice(-8).map((message) => ({ role: message.role, text: message.text.slice(0, 1500) }));
    setMessages((current) => [...current, { id: ++nextId.current, role: "user", text: query }]);
    setQuestion(""); setLoading(true);
    try {
      const response = await fetch("/api/ask", { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, context: productId && !productError ? { productId } : null, history }) });
      const data = await response.json() as { answer?: string; recommendations?: ConsultantRecommendation[]; mode?: string; diagnostic?: { status: number; code: string; parameter: string } };
      if (data.diagnostic) console.warn("CONSULTANT_UNAVAILABLE", data.diagnostic);
      if (!controller.signal.aborted) setMessages((current) => [...current, { id: ++nextId.current, role: "assistant",
        text: data.answer || "Не удалось получить ответ. Попробуйте ещё раз или обратитесь в магазин.",
        recommendations: response.ok && Array.isArray(data.recommendations) ? data.recommendations : [], mode: data.mode }]);
    } catch {
      if (!controller.signal.aborted) setMessages((current) => [...current, { id: ++nextId.current, role: "assistant", text: "Не удалось связаться с консультантом. Попробуйте ещё раз или обратитесь в магазин.", mode: "catalog" }]);
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }

  return <div className="mx-auto max-w-4xl space-y-6 py-8">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="site-eyebrow">Помощь с выбором</p>
        <h1 className="mt-3 text-3xl font-bold">ИИ-консультант</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">Расскажите о задаче ухода и бюджете. Подберём варианты из каталога, объясним назначение и применение.</p>
      </div>
      <button className="btn-secondary" disabled={loading} onClick={() => { setMessages([]); setQuestion(initialQuestion); textareaRef.current?.focus(); }}>Новый диалог</button>
    </div>
    <p className="rounded-2xl border bg-white p-4 text-xs leading-6 text-gray-600">Ответы создаёт ИИ на основе сведений магазина; он может ошибаться. Сообщения передаются сервису ИИ. Не указывайте личные данные и медицинские документы. Консультация помогает выбрать косметику и не заменяет специалиста.</p>
    {productLoading && <p role="status" className="text-sm text-gray-600">Загружаем сведения о товаре…</p>}
    {productError && <p role="alert" className="text-sm text-gray-600">Товар недоступен. Вы можете задать общий вопрос или <Link href="/shop" className="underline">выбрать другой товар</Link>.</p>}
    {product && <div className="site-panel rounded-2xl p-4">
      <p className="text-xs text-gray-500">Вопрос о товаре</p>
      <Link href={`/shop/${encodeURIComponent(product.slug)}`} className="font-semibold underline">{product.name}</Link>
      <p className="mt-1 text-sm text-gray-600">{product.brand?.name} • {product.category} • {product.price === null ? "Нет в наличии" : `${product.volume ? `${product.volume} • ` : ""}${product.price.toLocaleString("ru-RU")} ₸`}</p>
    </div>}
    {!messages.length && !product && <div className="flex flex-wrap gap-2" aria-label="Примеры вопросов">
      {examples.map((example) => <button key={example} className="btn-secondary text-sm" onClick={() => { setQuestion(example); textareaRef.current?.focus(); }}>{example}</button>)}
    </div>}
    <div className="space-y-4" aria-busy={loading}>
      {messages.map((message, index) => <div key={message.id} ref={message.role === "assistant" && index === messages.length - 1 ? answerRef : undefined}
        tabIndex={message.role === "assistant" ? -1 : undefined} className={`rounded-2xl border p-4 outline-none ${message.role === "user" ? "bg-gray-50" : "bg-white"}`} aria-label={message.role === "user" ? "Ваш вопрос" : "Ответ консультанта"}>
        <p className="mb-2 text-xs font-semibold text-gray-500">{message.role === "user" ? "Вы" : message.mode === "ai" ? "ИИ-консультант" : message.mode === "catalog" ? "Подбор каталога" : "Консультант"}</p>
        <p className="whitespace-pre-line text-sm leading-7">{message.text}</p>
        {!!message.recommendations?.length && <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {message.recommendations.map((card) => <Recommendation key={card.id} product={card} />)}
        </div>}
      </div>)}
      {loading && <p role="status" className="text-sm text-gray-500">Ищем подходящие средства и готовим ответ…</p>}
    </div>
    <form className="site-panel space-y-3 rounded-2xl p-4" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
      <label htmlFor="consultant-question" className="block text-sm font-semibold">Ваш вопрос</label>
      <textarea id="consultant-question" ref={textareaRef} className="w-full resize-y rounded-xl border bg-white px-3 py-3 text-sm" rows={3} maxLength={2000} value={question}
        onChange={(event) => setQuestion(event.target.value)} placeholder="Например: нужен крем для чувствительной кожи до 10 000 ₸"
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void ask(); } }} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-gray-500">Enter — отправить, Shift+Enter — новая строка</p>
        <button type="submit" className="btn" disabled={loading || productLoading || question.trim().length < 3}>{loading ? "Готовим ответ…" : "Спросить консультанта"}</button>
      </div>
    </form>
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <Link href="/care" className="underline">Подбор по фильтрам</Link>
      {SITE_WHATSAPP_URL && <a href={SITE_WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="underline">Помощь магазина в WhatsApp</a>}
    </div>
  </div>;
}

function Recommendation({ product }: { product: ConsultantRecommendation }) {
  const href = `/shop/${encodeURIComponent(product.slug)}`;
  return <article className="flex flex-col rounded-xl border p-3">
    <Link href={href} aria-label={`Открыть товар: ${product.name}`}><img src={product.image} alt={product.name} width={200} height={200} loading="lazy" className="mb-3 h-36 w-full rounded-lg object-contain" /></Link>
    <p className="text-xs text-gray-500">{product.brand} • {product.category}</p>
    <Link href={href} className="mt-1 text-sm font-semibold hover:underline">{product.name}</Link>
    <p className="mt-2 text-xs leading-5 text-gray-600">{product.reason || product.summary}</p>
    {product.sourceUrl && <a href={product.sourceUrl} className="mt-2 text-xs underline" target="_blank" rel="noopener noreferrer">Источник сведений</a>}
    <div className="mt-auto pt-3">
      <p className="text-xs text-gray-600">{product.volume ? `${product.volume} • ` : ""}В наличии: {product.stock}</p>
      <p className="my-2 font-semibold">{product.price.toLocaleString("ru-RU")} ₸</p>
      <AddToCartButton productId={product.id} variantId={product.variantId} maxStock={product.stock} />
      <Link href={href} className="mt-2 block text-xs underline">Инструкция и другие объёмы</Link>
    </div>
  </article>;
}
