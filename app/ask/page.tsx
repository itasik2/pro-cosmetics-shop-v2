// app/ask/page.tsx
import { Suspense } from "react";
import AskClient from "./AskClient";

export const dynamic = "force-dynamic";

export default function AskPage() {
  return (
    <Suspense fallback={<div className="py-8 text-sm text-gray-500">Загрузка…</div>}>
      <AskClient />
    </Suspense>
  );
}
