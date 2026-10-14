export function enrichmentFailureMessage(code: string) {
  const messages: Record<string, string> = {
    openai_timeout:
      "Поиск не успел получить ответ ИИ. Повторите попытку позже или укажите точный адрес товара.",
    enrichment_timeout:
      "Время поиска истекло. Повторите попытку или укажите точный адрес товара.",
    openai_search_incomplete:
      "Официальный поиск не завершился, а другой источник не найден. Это не подтверждает отсутствие товара; повторите попытку позже.",
    openai_search_not_run: "ИИ не выполнил поиск источника. Повторите попытку.",
    openai_incomplete_output: "Ответ ИИ не завершён. Повторите поиск.",
    openai_not_configured:
      "Поиск ИИ не настроен. Проверьте серверный ключ OpenAI.",
  };
  return messages[code] || code;
}

export function canRetryEnrichment(product: {
  enrichmentJobs: Array<{ status: string }>;
  enrichmentProposals: unknown[];
}) {
  return (
    product.enrichmentProposals.length === 0 &&
    (!product.enrichmentJobs.length ||
      product.enrichmentJobs[0].status === "FAILED")
  );
}
