import AdminProductsClient from "./AdminProductsClient"; // если файл рядом
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return <AdminProductsClient />;
}
