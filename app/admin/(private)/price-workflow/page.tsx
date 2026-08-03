import { prisma } from "@/lib/prisma";
import PriceWorkflowClient, {
  type PriceWorkflowStep,
} from "./PriceWorkflowClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  searchParams?: {
    step?: string | string[];
  };
};

function normalizeStep(value: string | string[] | undefined): PriceWorkflowStep {
  const step = Array.isArray(value) ? value[0] : value;
  if (step === "enrichment" || step === "publication") return step;
  return "import";
}

export default async function Page({ searchParams }: PageProps) {
  const [suppliers, brands] = await Promise.all([
    prisma.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, siteUrl: true },
    }),
    prisma.brand.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, slug: true },
    }),
  ]);

  return (
    <PriceWorkflowClient
      initialStep={normalizeStep(searchParams?.step)}
      initialSuppliers={suppliers}
      initialBrands={brands}
    />
  );
}
