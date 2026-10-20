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
    product_sources_unavailable:
      "Найденные страницы товара устарели или временно недоступны. Повторите поиск позже или укажите рабочую ссылку на этот SKU.",
    product_page_not_found_after_stale_source:
      "Сохранённая ссылка больше не работает. Другой подходящий источник пока не найден. Можно указать рабочую ссылку вручную.",
    source_url_required:
      "Укажите ссылку на товар или запустите автоматический поиск по SKU.",
    source_domain_not_allowed:
      "Этот сайт не разрешён для поставщика. Укажите другой источник или запустите автоматический поиск по SKU.",
  };
  if (/^source_http_(?:404|410)$/.test(code))
    return "Страница товара больше не доступна. Проверьте ссылку или очистите поле ссылки для автоматического поиска по SKU.";
  if (
    /^source_http_(?:403|429|5\d\d)$/.test(code) ||
    /^source_(?:fetch_failed|content_type_not_allowed):/.test(code) ||
    /^source_(?:timeout|dns_not_found|too_many_redirects|redirect_without_location)$/.test(
      code,
    ) ||
    /\b(?:EAI_AGAIN|ENOTFOUND|ECONNRESET|ETIMEDOUT)\b/.test(code)
  )
    return "Сайт источника не ответил или временно недоступен. Повторите поиск позже или укажите другую ссылку.";
  return messages[code] || code;
}

export function variantPhotoSearchIssue(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/openai_not_configured/.test(message))
    return {
      code: "ai_not_configured",
      message: "Поиск ИИ не настроен. Проверьте серверный ключ OpenAI.",
    };
  if (/openai_http_(?:401|403)/.test(message))
    return {
      code: "ai_access_denied",
      message:
        "Сервис ИИ отклонил доступ. Проверьте ключ и права проекта OpenAI.",
    };
  if (/openai_http_429/.test(message))
    return {
      code: "ai_limit",
      message:
        "Достигнут лимит сервиса ИИ. Проверьте квоту и повторите поиск позже.",
    };
  if (/openai_http_400/.test(message))
    return {
      code: "ai_request_rejected",
      message: "Сервис ИИ отклонил запрос. Проверьте настройки модели поиска.",
    };
  if (/timeout|AbortError/.test(message))
    return {
      code: "search_timeout",
      message: "Источник или ИИ не ответил вовремя. Повторите поиск позже.",
    };
  if (/openai_/.test(message))
    return {
      code: "ai_unavailable",
      message: "ИИ не завершил поиск. Повторите попытку позже.",
    };
  if (/^source_|EAI_AGAIN|ENOTFOUND/.test(message))
    return {
      code: "source_unavailable",
      message: "Не удалось открыть сайт поставщика. Повторите поиск позже.",
    };
  return {
    code: "search_failed",
    message: "Поиск фото не завершён. Повторите попытку позже.",
  };
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
