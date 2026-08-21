import { isQazPostApiConfigured, qazPostTrackingUrl } from "@/lib/shipping/qazpost";

type Props = {
  orderId: string;
  returnTo: string;
  paymentStatus: string;
  shippingServiceCode?: string | null;
  shippingStatus?: string | null;
  trackingNumber?: string | null;
  shippingPrice?: number | null;
  shippingWeightGrams?: number | null;
  shipmentLabelUrl?: string | null;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
  shippingUpdatedAt?: Date | null;
};

const statuses = [
  ["NOT_CREATED", "Не создано"],
  ["CREATED", "Создано"],
  ["SHIPPED", "Передано в QazPost"],
  ["IN_TRANSIT", "В пути"],
  ["DELIVERED", "Доставлено"],
  ["CANCELED", "Отменено"],
  ["ERROR", "Ошибка"],
] as const;

export default function QazPostShippingPanel(props: Props) {
  const configured = isQazPostApiConfigured();
  const trackingUrl = props.trackingNumber ? qazPostTrackingUrl(props.trackingNumber) : "";

  return (
    <div className="rounded-2xl border p-4 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-bold">Доставка QazPost</div>
          <div className="mt-1 text-xs text-gray-500">
            {configured
              ? "Bearer-токен QazPost настроен. Поиск и нормализация адресов через Open API доступны."
              : "API-токен QazPost ещё не настроен. Трек-номер можно сохранить вручную; клиент всё равно получит ссылку отслеживания."}
          </div>
        </div>
        <span className="rounded-full border px-2 py-1 text-xs whitespace-nowrap">
          {statuses.find(([value]) => value === (props.shippingStatus || "NOT_CREATED"))?.[1] || props.shippingStatus || "Не создано"}
        </span>
      </div>

      <form action={`/admin/orders/${props.orderId}/shipping`} method="post" className="space-y-3">
        <input type="hidden" name="returnTo" value={props.returnTo} />
        <input type="hidden" name="action" value="save" />

        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm text-gray-600">Трек-номер</span>
            <input
              name="trackingNumber"
              defaultValue={props.trackingNumber || ""}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="Например, CM123456789KZ"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm text-gray-600">Статус QazPost</span>
            <select
              name="shippingStatus"
              defaultValue={props.shippingStatus || "NOT_CREATED"}
              className="w-full rounded-xl border bg-white px-3 py-2"
            >
              {statuses.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label className="space-y-1">
            <span className="text-sm text-gray-600">Услуга / код тарифа</span>
            <input
              name="shippingServiceCode"
              defaultValue={props.shippingServiceCode || ""}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="После подключения API"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm text-gray-600">Вес упаковки, г</span>
            <input
              type="number"
              min={0}
              max={100000}
              name="shippingWeightGrams"
              defaultValue={props.shippingWeightGrams ?? ""}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="Например, 850"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm text-gray-600">Стоимость доставки, ₸</span>
            <input
              type="number"
              min={0}
              max={10000000}
              name="shippingPrice"
              defaultValue={props.shippingPrice ?? ""}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="0"
            />
          </label>

          <label className="space-y-1">
            <span className="text-sm text-gray-600">Ссылка на этикетку</span>
            <input
              type="url"
              name="shipmentLabelUrl"
              defaultValue={props.shipmentLabelUrl || ""}
              className="w-full rounded-xl border px-3 py-2"
              placeholder="https://..."
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white">
            Сохранить QazPost
          </button>
          {trackingUrl ? (
            <a
              href={trackingUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold"
            >
              Отследить на post.kz
            </a>
          ) : null}
          {props.shipmentLabelUrl ? (
            <a
              href={props.shipmentLabelUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold"
            >
              Открыть этикетку
            </a>
          ) : null}
        </div>
      </form>

      {props.trackingNumber ? (
        <form action={`/admin/orders/${props.orderId}/shipping`} method="post">
          <input type="hidden" name="returnTo" value={props.returnTo} />
          <input type="hidden" name="action" value="mark_shipped" />
          <button
            type="submit"
            disabled={props.paymentStatus !== "PAID" && props.paymentStatus !== "REFUNDED"}
            className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Передать в отправку
          </button>
        </form>
      ) : null}

      <div className="text-xs text-gray-500 space-y-1">
        {props.shippingUpdatedAt ? <div>Обновлено: {props.shippingUpdatedAt.toLocaleString("ru-RU")}</div> : null}
        {props.shippedAt ? <div>Передано в доставку: {props.shippedAt.toLocaleString("ru-RU")}</div> : null}
        {props.deliveredAt ? <div>Доставлено: {props.deliveredAt.toLocaleString("ru-RU")}</div> : null}
      </div>
    </div>
  );
}
