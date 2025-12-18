// app/about/page.tsx
export const metadata = {
  title: "О нас – pro.cosmetics",
  description:
    "Магазин профессиональной косметики pro.cosmetics. Мы подбираем рабочие средства с понятными составами и честными описаниями.",
};

export default function AboutPage() {
  return (
    <div className="space-y-4 py-6">
      <h1 className="text-3xl font-bold">О нас</h1>
      <p className="text-gray-700">
        pro.cosmetics — это небольшой магазин профессиональной косметики для
        домашнего ухода. Мы выбираем только те средства, которые готовы
        использовать сами: без лишней «магии маркетинга», с понятными
        составами и честными описаниями.
      </p>
      <p className="text-gray-700">
        Наша цель — помочь вам выстроить простой и рабочий уход за кожей: от
        базового очищения до анти-эйдж и средств для проблемной кожи.
      </p>
    </div>
  );
}
