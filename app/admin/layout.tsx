import type { ReactNode } from "react";
import { PRIVATE_PAGE_METADATA } from "@/lib/privatePageMetadata";

export const metadata = PRIVATE_PAGE_METADATA;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return children;
}
