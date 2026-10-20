import { ImportConsole } from "@/components/ImportConsole";
export const dynamic = "force-dynamic";
export default function ImportPage(){return <ImportConsole localMode={process.env.CATALOG_HUB_LOCAL_MODE==="true"}/>;}
