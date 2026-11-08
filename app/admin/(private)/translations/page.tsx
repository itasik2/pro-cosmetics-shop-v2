import AdminTranslationsClient from "./AdminTranslationsClient";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminTranslationsPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Переводы сайта</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-600">
          Названия и описания товаров и статей. ИИ готовит черновик, публикация
          доступна после проверки редактором. Русские оригиналы не изменяются.
        </p>
      </div>
      <AdminTranslationsClient />
    </div>
  );
}
