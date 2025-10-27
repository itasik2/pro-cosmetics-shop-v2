import { getStripe } from "@/lib/stripe";

export async function POST(req: Request) {
  const stripe = getStripe();
  const { items } = await req.json();
  if (!stripe) {
    return new Response(JSON.stringify({ url: null, note: "Stripe не настроен. Добавьте ключи в .env." }), { status: 200 });
  }
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: items.map((i: any) => ({
      price_data: {
        currency: "kzt",
        product_data: { name: i.name },
        unit_amount: i.price
      },
      quantity: i.quantity
    })),
    mode: "payment",
    success_url: `${process.env.NEXTAUTH_URL}/success`,
    cancel_url: `${process.env.NEXTAUTH_URL}/checkout`
  });
  return Response.json({ url: session.url });
}
