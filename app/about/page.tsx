import Link from "next/link";
import {
  SITE_ABOUT_GOAL,
  SITE_ABOUT_SUMMARY,
  SITE_BRAND,
  SITE_NICHE_LABEL,
} from "@/lib/siteConfig";

export const metadata = {
  title: `О нас – ${SITE_BRAND}`,
  description: `${SITE_BRAND} — магазин профессиональной косметики с понятным подбором, содержательными карточками и доставкой по Казахстану.`,
};

const PRINCIPLES = [
  {
    title: "Ассортимент с логикой",
    text: "В каталоге собраны средства для конкретных этапов и задач ухода. Это помогает сравнивать подходящие решения, а не теряться среди случайных позиций.",
  },
  {
    title: "Информация из надёжных источников",
    text: "Мы уточняем назначение, тип кожи, способ применения и подтверждённые преимущества продукта. Если данных недостаточно, не выдаём предположение за факт.",
  },
  {
    title: "Честная подача",
    text: "Карточки объясняют пользу средства профессионально, но понятным языком — без громких обещаний, искусственной срочности и рекламного шума.",
  },
  {
    title: "Каталог остаётся актуальным",
    text: "Автоматический мониторинг помогает замечать изменения в источниках и интерес к товарам. Все автоматические решения ограничены товарами, которые уже есть в магазине.",
  },
] as const;

const PRODUCT_BENEFITS = [
  "Средства для последовательного домашнего и профессионально ориентированного ухода.",
  "Понятное разделение по категориям, задачам кожи и формату продукта.",
  "Подробное описание: что это за средство, кому подходит, чего ожидать и как применять.",
  "Возможность спокойно сравнить варианты и выбрать продукт под свою схему ухода.",
] as const;

export default function AboutPage() {
  return (
    <main className="space-y-10 py-6">
      <section className="overflow-hidden rounded-3xl border border-rose-100 bg-gradient-to-br from-rose-100 via-white to-amber-50 p-7 md:p-12">
        <div className="max-w-4xl">
          <div className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-700">
            О магазине {SITE_BRAND}
          </div>
          <h1 className="mt-3 text-3xl font-bold tracking-tight md:text-5xl">
            Профессиональная косметика, которую легко понять и правильно
            выбрать
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-gray-700">
            {SITE_BRAND} — это {SITE_ABOUT_SUMMARY} Мы соединяем профессиональный
            ассортимент, проверенную информацию и удобную подачу, чтобы выбор
            ухода был осознанным, а не случайным.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/shop" className="btn px-5 py-3">
              Подобрать средства
            </Link>
            <Link
              href="/contacts"
              className="inline-flex items-center justify-center rounded-xl border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-800 transition hover:border-gray-500"
            >
              Связаться с нами
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-3xl bg-gray-900 p-7 text-white md:p-9">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-200">
            Наша цель
          </div>
          <h2 className="mt-3 text-2xl font-semibold md:text-3xl">
            Не просто продать средство, а помочь собрать понятный уход
          </h2>
          <p className="mt-4 leading-7 text-gray-200">{SITE_ABOUT_GOAL}</p>
          <p className="mt-4 leading-7 text-gray-200">
            Хороший выбор начинается с ответов на простые вопросы: что это за
            продукт, для каких задач он создан, как включить его в уход и чем он
            отличается от похожих средств. Именно такие ответы мы стараемся
            давать в каждой карточке.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {PRINCIPLES.map((principle, index) => (
            <article key={principle.title} className="rounded-3xl border bg-white p-6 shadow-sm">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-100 font-bold text-rose-800">
                {index + 1}
              </div>
              <h3 className="mt-4 text-lg font-semibold">{principle.title}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                {principle.text}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border bg-white p-7 md:p-10">
        <div className="grid gap-8 md:grid-cols-2 md:items-center">
          <div>
            <div className="text-sm font-semibold uppercase tracking-[0.18em] text-rose-700">
              Что вы получаете
            </div>
            <h2 className="mt-2 text-2xl font-semibold md:text-3xl">
              Уверенность в выборе на каждом шаге
            </h2>
            <p className="mt-4 leading-7 text-gray-700">
              Мы развиваем {SITE_NICHE_LABEL} как удобный и содержательный
              каталог. Здесь важны не только красивые фотографии, но и сведения,
              которые действительно помогают принять решение.
            </p>
            <p className="mt-4 leading-7 text-gray-700">
              Вы выбираете не просто красивую упаковку, а понятный продукт с
              определённым местом в уходе. Это экономит время, снижает риск
              случайной покупки и помогает сосредоточиться на потребностях кожи.
            </p>
          </div>

          <ul className="space-y-3">
            {PRODUCT_BENEFITS.map((benefit) => (
              <li
                key={benefit}
                className="flex gap-3 rounded-2xl bg-gradient-to-r from-rose-50 to-amber-50 p-4 text-sm leading-6 text-gray-700"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-rose-700 text-xs font-bold text-white">
                  ✓
                </span>
                <span>{benefit}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="rounded-3xl bg-gradient-to-r from-rose-700 to-fuchsia-700 p-7 text-white md:flex md:items-center md:justify-between md:gap-8 md:p-10">
        <div className="max-w-3xl">
          <h2 className="text-2xl font-semibold md:text-3xl">
            Найдите средство, которое решает именно вашу задачу
          </h2>
          <p className="mt-3 leading-7 text-rose-50">
            Начните с категории, сравните подробные карточки и соберите уход без
            лишних шагов. Каталог будет становиться точнее и полезнее по мере
            обновления данных и ассортимента.
          </p>
        </div>
        <Link
          href="/shop"
          className="mt-6 inline-flex shrink-0 items-center justify-center rounded-xl bg-white px-5 py-3 text-sm font-semibold text-rose-800 shadow-sm transition hover:bg-rose-50 md:mt-0"
        >
          Перейти в каталог
        </Link>
      </section>
    </main>
  );
}
