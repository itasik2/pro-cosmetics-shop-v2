import AdminProductsClient from "./AdminProductsClient";
import DraftProductsPublisher from "./DraftProductsPublisher";
import VariantMergeMaintenance from "./VariantMergeMaintenance";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return (
    <div className="space-y-6">
      <DraftProductsPublisher />
      <VariantMergeMaintenance />
      <AdminProductsClient />
    </div>
  );
}
