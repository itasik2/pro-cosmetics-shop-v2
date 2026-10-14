import AdminProductSearchBar from "./AdminProductSearchBar";
import AdminProductsClient from "./AdminProductsClient";
import DraftProductsPublisher from "./DraftProductsPublisher";
import VariantMergeMaintenance from "./VariantMergeMaintenance";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return (
    <div className="space-y-4">
      <AdminProductSearchBar />
      <AdminProductsClient />
      <details className="rounded-2xl border bg-white p-4">
        <summary className="cursor-pointer font-medium">
          Публикация и объединение товаров
        </summary>
        <div className="mt-4 space-y-4">
          <DraftProductsPublisher />
          <VariantMergeMaintenance />
        </div>
      </details>
    </div>
  );
}
