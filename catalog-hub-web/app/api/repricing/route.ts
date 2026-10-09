import { NextRequest, NextResponse } from "next/server";
import { hubFetch, organizationId } from "@/lib/hub";
export const dynamic = "force-dynamic";
const actions = { policy:"policies", observation:"observations", evaluate:"evaluate" } as const;
export async function POST(req:NextRequest) {
  if (req.headers.get("origin") !== req.nextUrl.origin) {
    return NextResponse.json({error:"invalid_origin"},{status:403});
  }
  const o=await req.json().catch(()=>null);
  if (!o || typeof o!=="object" || Array.isArray(o) ||
      !(o.action in actions) || typeof o.productId!=="string") {
    return NextResponse.json({error:"invalid_body"},{status:400});
  }
  const action=o.action as keyof typeof actions;
  try {
    const result=await hubFetch<unknown>("/v1/repricing/"+actions[action],{
      method:"POST",body:JSON.stringify({...o,organizationId,action:undefined}),
    });
    return NextResponse.json(result,{headers:{"cache-control":"no-store"}});
  } catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"repricing_failed"},{status:400});
  }
}
