import { SITE_BRAND, getScopedEnv } from "@/lib/siteConfig";
// lib/notify.ts
type NotifyArgs = {
  orderNumber: string;
  totalAmount: number;
  customerName: string;
  phone: string;
  deliveryType: string;
  address?: string | null;
};

export async function notifyAdminNewOrder(args: NotifyArgs) {
  const adminEmail = getScopedEnv("ADMIN_EMAIL").trim();
  const resendKey = getScopedEnv("RESEND_API_KEY").trim();

  if (!adminEmail) return; // тихо пропускаем

  // Если Resend не настроен — просто лог
  if (!resendKey) {
    console.log("[notify] New order:", args);
    return;
  }

  const subject = `Новый заказ ${args.orderNumber} • ${args.totalAmount.toLocaleString("ru-RU")} ₸`;

  const lines = [
    `Заказ: ${args.orderNumber}`,
    `Сумма: ${args.totalAmount} KZT`,
    `Клиент: ${args.customerName}`,
    `Телефон: ${args.phone}`,
    `Доставка: ${args.deliveryType}`,
    args.address ? `Адрес: ${args.address}` : null,
  ].filter(Boolean);

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${SITE_BRAND} <onboarding@resend.dev>`,
      to: [adminEmail],
      subject,
      text: lines.join("\n"),
    }),
  }).catch((e) => {
    console.error("[notify] failed:", e);
  });
}
