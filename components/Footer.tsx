// components/Footer.tsx
import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t mt-10">
      <div className="container mx-auto py-6 flex flex-col md:flex-row gap-4 justify-between text-sm text-gray-600">
        <div>
          <div className="font-semibold">pro.cosmetics</div>
          <div>Интернет-магазин профессиональной косметики</div>
        </div>
        <div className="flex flex-col md:flex-row gap-4">
          <div>
            <div className="font-semibold mb-1">Навигация</div>
            <div className="flex flex-col gap-1">
              <Link href="/shop">Каталог</Link>
              <Link href="/blog">Блог</Link>
              <Link href="/ask">Q&A</Link>
            </div>
          </div>
          <div>
            <div className="font-semibold mb-1">Контакты</div>
            <div>Тел.: +7 …</div>
            <div>Email: sales@vita-services.com</div>
          </div>
        </div>
      </div>
    </footer>
  );
}
