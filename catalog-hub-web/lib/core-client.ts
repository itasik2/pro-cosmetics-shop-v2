export type CoreProduct = { id: string; sku: string; title: string };
export type CoreWarehouse = { id: string; name: string; code: string };
export type CoreConnection = { id: string; name: string; adapter: string; environment: string; mode: string; version: number; offerCount: number;
  settings?: { company?: string; merchantId?: string; expectedSellerSkus?: string[] } | null };
export type CoreBalance = { productId: string; warehouseId: string; onHand: number; reserved: number; safetyStock: number; revision: number; sku: string; warehouseName: string; available: number };
export type CoreOrder = { id: string; connectionId: string; externalOrderId: string; channelName: string; status: string; createdAt: string;
  items: Array<{ productId: string; warehouseId: string; sku: string; quantity: number; returned: number }> };

const messages: Record<string,string> = {
  variant_group_size_invalid: "Выберите от 2 до 50 разных SKU.",
  variant_already_grouped: "Один из товаров уже входит в группу. Сначала проверьте существующее объединение.",
  variant_preview_stale: "Карточки изменились после предпросмотра. Проверьте объединение заново.",
  variant_undo_conflict: "После объединения карточка была изменена. Автоматический откат заблокирован для сохранения правок.",
  variant_shared_fields_readonly: "Общие поля редактируются в основной карточке товара.",
  import_row_stale: "Карточка изменилась после проверки. Загрузите прайс заново для нового предпросмотра.",
  import_version_conflict: "Прогресс задачи изменился. Обновите данные перед действием.",
  import_incomplete_manifest: "Загружены не все подтверждённые строки. Продолжите подготовку файла.",
  import_queue_limit: "В очереди уже десять незавершённых импортов. Дождитесь завершения или остановите ненужные.",
  import_retry_limit: "Достигнут лимит повторов. Исправьте причину и создайте новый предпросмотр.",
  record_conflict: "SKU или другая уникальная связь уже существует. Создайте новый предпросмотр.",
  core_migration_required: "Для раздела требуется обновление серверной части.",
  inventory_version_conflict: "Остаток изменился. Обновите данные и проверьте операцию ещё раз.",
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
  return messages[message] || message;
}
export async function coreRequest<T>(path: string, body?: unknown, key?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch("/api/hub/v1/" + path, { cache: "no-store", signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
    ...(body !== undefined ? { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key || crypto.randomUUID() }, body: JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(data?.error || "Не удалось выполнить операцию"));
  return data as T;
}
