import type { ReactNode } from "react";
import { PRIVATE_PAGE_METADATA } from "@/lib/privatePageMetadata";
import Providers from "../providers";

export const metadata = PRIVATE_PAGE_METADATA;

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <Providers>{children}</Providers>;
}
