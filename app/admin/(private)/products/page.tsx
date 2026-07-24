import AdminProductsClient from "./AdminProductsClient";
import DraftProductsPublisher from "./DraftProductsPublisher";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return (
    <div className="space-y-6">
      <DraftProductsPublisher />
      <AdminProductsClient />
    </div>
  );
}
