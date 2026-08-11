"use client";

import { useEffect, useState } from "react";

export default function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(window.scrollY > 600);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      aria-label="Наверх"
      title="Наверх"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className="fixed bottom-5 right-4 z-50 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white/95 px-3 py-2 text-sm font-medium text-gray-700 shadow-lg backdrop-blur hover:border-gray-300 hover:bg-gray-100 sm:bottom-6 sm:right-6 sm:px-4"
    >
      <span aria-hidden="true" className="text-base leading-none">↑</span>
      <span className="hidden sm:inline">Наверх</span>
    </button>
  );
}
