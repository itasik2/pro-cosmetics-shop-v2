export function enrichmentErrorMessage(cause: unknown) {
  const message =
    cause instanceof Error ? cause.message : String(cause || "Поиск не удался");
  if (message === "openai_timeout")
    return "ИИ не успел завершить поиск. Повторите попытку или укажите прямую ссылку на товар.";
  if (
    [
      "openai_search_incomplete",
      "openai_search_not_run",
      "openai_incomplete_output",
      "openai_empty_output",
    ].includes(message)
  )
    return "ИИ не завершил проверку источников. Повторите поиск или укажите прямую ссылку на товар.";
  if (message === "source_timeout")
    return "Сайт источника отвечает слишком долго. Повторите поиск или укажите другую страницу товара.";
  if (message === "source_url_required")
    return "Источник не найден. Укажите ссылку на товар, настройте сайт производителя или разрешите поиск у других продавцов.";
  if (message === "openai_not_configured")
    return "Для автоматического поиска в сети нужен OPENAI_API_KEY в настройках сервера. Можно указать прямую ссылку на товар без ИИ-поиска.";
  if (message === "product_page_not_found")
    return "Страница товара не найдена. Укажите точную ссылку или разрешите поиск у других продавцов.";
  if (message === "product_match_not_confirmed")
    return "Источник не совпадает с товаром по SKU, бренду или объёму. Проверьте ссылку и фасовку.";
  if (message === "source_domain_not_allowed")
    return "Источник отклонён. Проверьте ссылку на страницу товара и разрешённые домены.";
  if (message === "photo_product_changed")
    return "Карточка изменилась после поиска фото. Выполните поиск для актуального SKU и фасовки.";
  return message;
}

export function enrichmentWarningMessage(code: string) {
  const messages: Record<string,string> = {
    photo_files_rejected: "Часть ссылок не прошла проверку изображения или разрешения.",
    photo_identity_or_file_unconfirmed: "Подходящее фото не подтверждено. Проверьте точную страницу товара.",
    photo_sku_mismatch: "Артикул фотографии относится к другой позиции.",
    photo_brand_mismatch: "Бренд фотографии отличается от бренда товара.",
    photo_brand_unconfirmed: "Бренд фотографии не подтверждён источником.",
    photo_volume_mismatch: "Фото относится к другой фасовке.",
    photo_volume_ambiguous: "Источник содержит несколько фасовок без однозначной привязки фото.",
    photo_volume_unconfirmed: "Фасовка фотографии не подтверждена источником.",
    photo_name_mismatch: "Название товара на странице фотографии отличается.",
    unverified_official_site_manual_review_required: "Проверьте принадлежность источника производителю.",
    external_source_manual_review_required: "Данные другого продавца требуют проверки.",
  };
  return messages[code] || code;
}
