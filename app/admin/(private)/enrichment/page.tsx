import { redirect } from "next/navigation";

export default function Page() {
  redirect("/admin/price-workflow?step=enrichment");
}
