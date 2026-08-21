import AdminProductSearchBar from "./AdminProductSearchBar";
import AdminProductsClient from "./AdminProductsClient";
import DraftProductsPublisher from "./DraftProductsPublisher";
import VariantMergeMaintenance from "./VariantMergeMaintenance";
import VariantStockManager from "./VariantStockManager";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return (
    <div className="space-y-4">
      <AdminProductSearchBar />
      <DraftProductsPublisher />
      <VariantMergeMaintenance />
      <VariantStockManager />
      <AdminProductsClient />
    </div>
  );
}
