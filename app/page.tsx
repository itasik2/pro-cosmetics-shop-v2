import Link from "next/link";

export default async function Home() {
  return (
    <section className="space-y-8">
      <div className="rounded-3xl bg-gradient-to-br from-gray-100 to-white border p-10">
        <h1 className="text-3xl md:text-5xl font-bold tracking-tight">
          Профессиональная косметика без шума и пыли
        </h1>
        <p className="mt-3 text-gray-600 max-w-2xl">
          Только проверенные позиции. Нормальные составы, честные описания и цены без магии маркетинга.
        </p>
        <div className="mt-6">
          <Link href="/shop" className="btn">Перейти в каталог</Link>
        </div>
      </div>
    </section>
  );
}
