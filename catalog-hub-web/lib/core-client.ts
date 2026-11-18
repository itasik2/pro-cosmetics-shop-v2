export type CoreProduct = { id: string; sku: string; title: string };
export type CoreWarehouse = { id: string; name: string; code: string };
export type CoreConnection = { id: string; name: string; adapter: string; environment: string; mode: string; version: number; offerCount: number;
  settings?: { company?: string; merchantId?: string; expectedSellerSkus?: string[] } | null };
export type CoreBalance = { productId: string; warehouseId: string; onHand: number; reserved: number; safetyStock: number; revision: number; sku: string; warehouseName: string; available: number };
export type CoreOrder = { id: string; connectionId: string; externalOrderId: string; channelName: string; status: string; createdAt: string;
  items: Array<{ productId: string; warehouseId: string; sku: string; quantity: number; returned: number }> };

const messages: Record<string,string> = {
  invalid_webhook_url:"Нужен HTTPS-адрес получателя без логина, пароля, параметров и фрагмента.",
  invalid_delivery_secret_ref:"Укажите имя серверной настройки CATALOG_DELIVERY_SECRET_… .",
  invalid_delivery_topics:"Выберите хотя бы один поддерживаемый тип изменений.",
  delivery_signing_not_configured:"Серверный секрет доставки ещё не настроен.",
  webhook_version_conflict:"Настройки получателя изменились. Обновите доставки и проверьте их заново.",
  webhook_limit:"Достигнут предел десяти получателей организации.",
  delivery_version_conflict:"Статус доставки изменился. Обновите список.",
  delivery_retry_confirmation_required:"Повтор доступен только после подтверждения для доставки, требующей проверки.",
  delivery_target_changed:"Получатель изменён. Для нового адреса создано отдельное уведомление.",
  ENDPOINT_CHANGED:"Получатель или состав событий изменён.",
  LEASE_EXHAUSTED:"Восемь попыток завершились без подтверждения. Проверьте обработчик и получателя.",
  DELIVERY_RECEIPT_MISMATCH:"Ответ получателя не подтвердил это уведомление.",
  DELIVERY_SIGNATURE_INVALID:"Подпись подтверждения получателя не прошла проверку.",
  DELIVERY_TARGET_BLOCKED:"Адрес получателя не разрешён в настройках обработчика.",
  DELIVERY_DNS_BLOCKED:"Получатель недоступен по разрешённому публичному адресу.",
  DELIVERY_UNAVAILABLE:"Не удалось получить подтверждение от получателя.",
  DELIVERY_TIMEOUT:"Получатель не ответил вовремя.",
  DELIVERY_SECRET_NOT_CONFIGURED:"Секрет доставки ещё не настроен у фонового обработчика.",
  delivery_not_found:"Доставка не найдена.",
  invalid_delivery_status:"Неизвестный статус доставки.",
  reservation_not_found: "Резерв не найден.",
  reservation_version_conflict: "Резерв изменился. Обновите список и проверьте операцию заново.",
  reservation_reference_conflict: "Номер документа уже занят резервом с другим составом или основанием.",
  reservation_quantity_exceeded: "Количество превышает оставшийся резерв или число отгруженных единиц.",
  reservation_nothing_to_apply: "Для этого действия нет доступного количества. Обновите список.",
  reservation_item_not_found: "Позиция не входит в выбранный резерв.",
  invalid_reservation_reference: "Укажите номер документа резерва длиной до 128 символов.",
  confirmation_required: "Подтвердите операцию перед сохранением.",
  revision_conflict: "Карточка изменилась после этой правки. Откат заблокирован.",
  revision_supplier_conflict: "Связь с поставщиком изменилась или прежний артикул уже занят.",
  revision_snapshot_unavailable: "Для этой записи нет полной пары значений до и после. Восстановление недоступно.",
  revision_category_unavailable: "Прежняя категория больше не активна.",
  revision_import_scope_required: "Для восстановления записи поставщика требуется право на импорт.",
  revision_not_found: "Запись истории не найдена.",
  variant_group_size_invalid: "Выберите от 2 до 50 разных SKU.",
  variant_already_grouped: "Один из товаров уже входит в группу. Сначала проверьте существующее объединение.",
  variant_preview_stale: "Карточки изменились после предпросмотра. Проверьте объединение заново.",
  variant_undo_conflict: "После объединения карточка была изменена. Автоматический откат заблокирован для сохранения правок.",
  variant_shared_fields_readonly: "Общие поля редактируются в основной карточке товара.",
  import_row_stale: "Карточка изменилась после проверки. Загрузите прайс заново для нового предпросмотра.",
  import_version_conflict: "Прогресс задачи изменился. Обновите данные перед действием.",
  import_incomplete_manifest: "Загружены не все подтверждённые строки. Продолжите подготовку файла.",
  import_queue_limit: "В очереди уже десять незавершённых импортов. Дождитесь завершения или остановите ненужные.",
  import_row_queue_limit: "В активных задачах зарезервирован лимит 20 000 строк. Дождитесь завершения или остановите ненужные задачи.",
  import_payload_queue_limit: "Очередь достигла лимита 64 МБ. Завершите или остановите другие задачи перед загрузкой.",
  import_run_payload_limit: "Данные одного импорта превышают 32 МБ. Разделите файл на несколько задач.",
  invalid_import_payload: "Данные строки некорректны или превышают 60 000 байт. Сократите содержимое строки.",
  import_retry_limit: "Достигнут лимит повторов. Исправьте причину и создайте новый предпросмотр.",
  record_conflict: "SKU или другая уникальная связь уже существует. Создайте новый предпросмотр.",
  channel_mapping_required: "В событии магазина нужны SKU канала и внешний код склада.",
  channel_signature_invalid: "Подпись события магазина не прошла проверку.",
  channel_signature_expired: "Время подписанного события истекло. Проверьте часы отправителя и отправьте новую подпись.",
  channel_signing_not_configured: "Для подключения не настроен серверный секрет подписи.",
  core_migration_required: "Для раздела требуется обновление серверной части.",
  inventory_version_conflict: "Остаток изменился. Обновите данные и проверьте операцию ещё раз.",
  invalid_reconciliation_cursor: "Позиция сверки устарела или некорректна. Запустите сверку сначала.",
  reservation_total_too_large: "Сумма резервов превышает допустимый диапазон. Проверьте количество в заказах.",
  channel_version_conflict: "Настройки канала изменились. Обновите страницу.",
  offer_version_conflict: "Предложение изменилось. Выберите товар заново.",
  insufficient_available_stock: "Недостаточно свободного остатка для резерва.",
  stock_below_reserved: "Операция уменьшит остаток ниже количества в резерве.",
  incomplete_feed_manifest: "Состав выгрузки не совпадает с полным списком SKU. Проверьте все предложения.",
  expected_seller_skus_required: "Укажите полный ожидаемый список SKU канала.",
  channel_warehouses_required: "Сопоставьте хотя бы один склад канала.",
  cost_or_price_floor_invalid: "Не указана закупочная цена или цена продажи ниже допустимой.",
  price_below_cost: "Цена предложения ниже закупочной.",
  offer_outside_financial_bounds: "Цена нарушает установленные границы, комиссию или минимальную маржу. Проверьте правило репрайсера.",
  channel_financial_policy_required: "Перед выгрузкой настройте правило цены и маржи для товара в разделе «Репрайсер».",
  channel_not_active: "Канал работает в режиме сравнения или приостановлен.",
  production_cutover_not_enabled: "Включение рабочего канала будет доступно после проверки пилота.",
  invalid_kaspi_seller_sku: "SKU Kaspi: до 20 латинских букв и цифр.",
  unsupported_operation: "Эта операция пока не поддерживается адаптером.",
  idempotency_key_reused: "Состав операции изменился. Проверьте данные и создайте новую операцию.",
  local_read_only_mode: "Изменения отключены в текущем окружении.",
};
export function coreMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const http=message.match(/^DELIVERY_HTTP_(\d{3})$/);if(http)return "Получатель вернул HTTP "+http[1]+".";
  return messages[message] || message;
}
export async function coreRequest<T>(path: string, body?: unknown, key?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/hub/v1/" + path, { cache: "no-store", signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
    ...(body !== undefined ? { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key || crypto.randomUUID() }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(data?.error || "Не удалось выполнить операцию"));
  return data as T;
}
