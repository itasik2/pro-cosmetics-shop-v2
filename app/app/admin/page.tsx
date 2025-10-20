import Link from "next/link";

export default function AdminIndex() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Админ-панель</h1>
      <div className="flex gap-3">
        <Link href="/admin/products" className="btn">Товары</Link>
        <Link href="/admin/orders" className="btn">Заказы</Link>
      </div>
      <p className="text-sm text-gray-600">Вход по логину/паролю через Credentials. См. .env.example</p>
    </div>
  );
}
