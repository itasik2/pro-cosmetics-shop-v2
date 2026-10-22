import { NextRequest,NextResponse } from "next/server";
import { hubFetch,organizationId } from "@/lib/hub";
import { isSameOrigin } from "@/lib/same-origin";
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

export async function POST(request:NextRequest) {
  if(!isSameOrigin(request))return NextResponse.json({error:"invalid_origin"},{status:403});
  if(Number(request.headers.get("content-length")||0)>10000)
    return NextResponse.json({error:"payload_too_large"},{status:413});
  const input=await request.json().catch(()=>null);
  if(!input||typeof input!=="object"||Array.isArray(input)||
    typeof input.productId!=="string"||!input.productId||input.productId.length>128||
    !input.preview||typeof input.preview!=="object"||Array.isArray(input.preview)||
    Object.entries(input.preview).some(([key,value])=>
      !["shortDescription","description"].includes(key)||typeof value!=="string"||value.length>3000))
    return NextResponse.json({error:"invalid_preview"},{status:400});
  try {
    const result=await hubFetch<unknown>("/v1/categories/suggest",{method:"POST",
      body:JSON.stringify({organizationId,productId:input.productId,preview:input.preview})});
    return NextResponse.json(result,{headers:{"cache-control":"no-store"}});
  } catch(error) {
    return NextResponse.json({error:error instanceof Error?error.message:"suggestion_failed"},{status:502});
  }
}
