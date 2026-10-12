import { NextRequest,NextResponse } from "next/server";
import { hubFetch,organizationId } from "@/lib/hub";
export const dynamic = "force-dynamic";
export async function GET(request:NextRequest) {
  const productId=request.nextUrl.searchParams.get("productId");
  if(!productId||productId.length>128) return NextResponse.json({error:"invalid_productId"},{status:400});
  try {
    const result=await hubFetch<unknown>("/v1/categories/suggest?organizationId="+
      encodeURIComponent(organizationId)+"&productId="+encodeURIComponent(productId));
    return NextResponse.json(result,{headers:{"cache-control":"no-store"}});
  } catch(e) {
    return NextResponse.json({error:e instanceof Error?e.message:"suggestion_failed"},{status:502});
  }
}
