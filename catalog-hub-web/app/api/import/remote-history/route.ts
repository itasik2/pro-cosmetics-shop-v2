import {NextResponse} from "next/server";
import {hubFetch,organizationId} from "@/lib/hub";
export const dynamic="force-dynamic";
export async function GET(){
 try{return NextResponse.json(await hubFetch("/v1/price-import/history?organizationId="+encodeURIComponent(organizationId)),
  {headers:{"cache-control":"no-store"}});}
 catch(e){return NextResponse.json({error:e instanceof Error?e.message:"history_unavailable"},{status:502});}
}
