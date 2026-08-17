export type PaymentInstructions = {
  recipientName: string;
  kaspiPhone: string;
  paymentLink: string;
  qrImageUrl: string;
  note: string;
  hasInstructions: boolean;
};

function env(name: string) {
  return (process.env[name] || "").trim();
}

export function getPaymentInstructions(): PaymentInstructions {
  const recipientName = env("PAYMENT_RECIPIENT_NAME");
  const kaspiPhone = env("KASPI_PAYMENT_PHONE");
  const paymentLink = env("KASPI_PAYMENT_LINK");
  const qrImageUrl = env("KASPI_PAYMENT_QR_IMAGE_URL");
  const note = env("PAYMENT_INSTRUCTIONS");

  return {
    recipientName,
    kaspiPhone,
    paymentLink,
    qrImageUrl,
    note,
    hasInstructions: Boolean(
      recipientName || kaspiPhone || paymentLink || qrImageUrl || note,
    ),
  };
}
