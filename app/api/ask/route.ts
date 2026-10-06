import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { collapseRepresentedProductCards } from "@/lib/publicProductCards";
import { parseConsultantCriteria, rankConsultantProducts, recommendationFromProduct, needsConsultantClarification, needsSpecialist } from "@/lib/consultantCatalog";
import { askCatalogAi } from "@/lib/consultantAi";
import { getScopedEnv, SITE_KEY } from "@/lib/siteConfig";
import { getStorePolicy } from "@/lib/storePolicy";

export const runtime = "nodejs";
export const maxDuration = 40;

const RequestSchema = z.object({
  query: z.string().trim().min(3).max(2000),
  context: z.object({ productId: z.string().max(100).optional() }).nullable().optional(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(1500) })).max(8).optional(),
});
const json = (body: object, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
const positiveLimit = (value: string, fallback: number) => /^\d+$/.test(value) && Number(value) > 0 ? Math.min(Number(value), 10000) : fallback;

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > 20000) return json({ answer: "Сообщение слишком длинное. Сократите вопрос." }, 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return json({ answer: "Не удалось прочитать вопрос. Попробуйте ещё раз." }, 400); }
    const parsed = RequestSchema.safeParse(body);
    if (!parsed.success) return json({ answer: "Введите вопрос от 3 до 2000 символов." }, 400);
    const { query, history = [], context } = parsed.data;
    const ip = getClientIp(req) || "unknown";
    const rateLimit = await checkRateLimit(`ask:${ip}`, 5, 60_000);
    if (!rateLimit.ok) return json({ answer: "Слишком много вопросов. Попробуйте через минуту." }, 429, { "Retry-After": String(rateLimit.retryAfterSec) });

    const productId = context?.productId || "";
    const userMessages = [...history.filter((item) => item.role === "user").map((item) => item.text), query];
    const criteria = parseConsultantCriteria(userMessages);
    if (needsSpecialist(userMessages)) return json({
      answer: "Я могу объяснить сведения о косметике, но не определить заболевание, назначить лечение или подтвердить безопасность при беременности и аллергии. Согласуйте уход со специалистом. Инструкцию и состав конкретного товара можно уточнить у магазина.",
      recommendations: [], mode: "safety",
    });
    if (needsConsultantClarification(criteria, productId)) return json({
      answer: "Для какой задачи вы выбираете уход: увлажнение, чувствительная кожа, жирная кожа или возрастной уход? Какое средство нужно и какой бюджет на него?",
      recommendations: [], mode: "clarification",
    });

    const rows = await prisma.product.findMany({
      where: { isPublished: true, enrichmentStatus: { not: "MERGED" }, ...(productId ? { id: productId } : {}) },
      select: { id: true, slug: true, name: true, image: true, description: true, shortDescription: true,
        category: true, productLineName: true, price: true, stock: true, variants: true,
        supplierId: true, volumeValue: true, volumeUnit: true, brand: { select: { name: true } },
        enrichmentProposals: { where: { status: "APPLIED" }, orderBy: { appliedAt: "desc" }, take: 1, select: { ingredients: true, sourceUrl: true } },
      },
    });
    if (productId && !rows.length) return json({ answer: "Этот товар недоступен. Выберите средство из каталога.", recommendations: [] }, 404);
    const candidates = rankConsultantProducts(collapseRepresentedProductCards(rows), criteria, productId).map((item) => item.product);
    const fallbackCards = candidates.flatMap((product) => {
      const card = recommendationFromProduct(product, criteria, "Соответствует выбранным фильтрам каталога. Назначение и применение уточните в карточке.");
      return card ? [card] : [];
    }).slice(0, 3);
    const fallback = (answer: string) => json({ answer, recommendations: /без\s+[а-яa-z]/iu.test(query) ? [] : fallbackCards, mode: "catalog" });
    if (getScopedEnv("AI_CONSULTANT_ENABLED") === "false") return fallback("Консультант временно отключён. Можно посмотреть варианты по фильтрам или обратиться в магазин.");
    const apiKey = getScopedEnv("OPENAI_API_KEY").trim();
    if (!apiKey) return fallback("Консультант пока недоступен. Ниже — варианты по фильтрам каталога; с выбором поможет магазин.");

    const day = new Date().toISOString().slice(0, 10);
    const perVisitor = await checkRateLimit(`ask:daily:${day}:${ip}`, 30, 86_400_000);
    if (!perVisitor.ok) return fallback("Лимит консультаций на сегодня достигнут. Обратитесь в магазин или используйте подбор по фильтрам.");
    const dailyLimit = positiveLimit(getScopedEnv("AI_CONSULTANT_DAILY_LIMIT"), 200);
    const daily = await checkRateLimit(`ask:daily:${SITE_KEY}:${day}`, dailyLimit, 86_400_000);
    if (!daily.ok) return fallback("Консультант сегодня временно недоступен. Подбор по фильтрам и помощь магазина доступны.");

    try {
      const reply = await askCatalogAi({ apiKey, model: getScopedEnv("OPENAI_ASK_MODEL").trim() || "gpt-4o-mini",
        query, history, criteria, products: candidates, ...getStorePolicy() });
      return json({ ...reply, mode: "ai" });
    } catch (error) {
      console.error("CONSULTANT_PROVIDER_ERROR", error instanceof Error && /^ai_/.test(error.message) ? error.message : "provider_unavailable");
      return fallback("Не удалось получить ответ ИИ. Можно посмотреть варианты по фильтрам или уточнить выбор у магазина.");
    }
  } catch {
    return json({ answer: "Консультант временно недоступен. Попробуйте ещё раз или обратитесь в магазин.", recommendations: [] }, 503);
  }
}
