import { qazPostTrackingUrl } from "@/lib/shipping/qazpost";

type Props = {
  shippingStatus?: string | null;
  trackingNumber?: string | null;
  shippingServiceCode?: string | null;
  shippingPrice?: number | null;
  shippedAt?: Date | null;
  deliveredAt?: Date | null;
};

function statusLabel(value?: string | null) {
  const labels: Record<string, string> = {
    NOT_CREATED: "Ожидает оформления",
    CREATED: "Отправление оформлено",
    SHIPPED: "Передано в QazPost",
    IN_TRANSIT: "В пути",
    DELIVERED: "Доставлено",
    CANCELED: "Доставка отменена",
    ERROR: "Требует уточнения",
  };
  return labels[String(value || "NOT_CREATED")] || String(value || "Ожидает оформления");
}

export default function QazPostTrackingPanel(props: Props) {
  if (!props.trackingNumber && (!props.shippingStatus || props.shippingStatus === "NOT_CREATED")) {
    return null;
  }

  const trackingUrl = props.trackingNumber ? qazPostTrackingUrl(props.trackingNumber) : "";

  return (
    <div className="rounded-2xl border p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Доставка QazPost</h2>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-900">
          {statusLabel(props.shippingStatus)}
        </span>
      </div>

      {props.trackingNumber ? (
        <div className="text-sm">
          <span className="text-gray-600">Трек-номер:</span>{" "}
          <span className="font-mono font-semibold">{props.trackingNumber}</span>
        </div>
      ) : null}
      {props.shippingServiceCode ? (
        <div className="text-sm"><span className="text-gray-600">Услуга:</span> {props.shippingServiceCode}</div>
      ) : null}
      {typeof props.shippingPrice === "number" ? (
        <div className="text-sm"><span className="text-gray-600">Стоимость доставки:</span> {props.shippingPrice.toLocaleString("ru-RU")} ₸</div>
      ) : null}
      {props.shippedAt ? (
        <div className="text-xs text-gray-500">Передано в доставку: {props.shippedAt.toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}</div>
      ) : null}
      {props.deliveredAt ? (
        <div className="text-xs text-gray-500">Доставлено: {props.deliveredAt.toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}</div>
      ) : null}

      {trackingUrl ? (
        <a
          href={trackingUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
        >
          Отследить на post.kz
        </a>
      ) : null}
    </div>
  );
}
