import {NextRequest,NextResponse} from "next/server";
import {hubFetch,organizationId} from "@/lib/hub";
import {isSameOrigin} from "@/lib/same-origin";

export const dynamic="force-dynamic";

export async function POST(request:NextRequest){
 if(!isSameOrigin(request))return NextResponse.json({error:"invalid_origin"},{status:403});
 if(Number(request.headers.get("content-length")||0)>40000)
   return NextResponse.json({error:"payload_too_large"},{status:413});
 const body=await request.json().catch(()=>null);
 if(!body||typeof body!=="object"||Array.isArray(body)||
   typeof body.productId!=="string"||typeof body.expectedUpdatedAt!=="string"||
   !body.proposed||typeof body.proposed!=="object"||Array.isArray(body.proposed))
   return NextResponse.json({error:"invalid_body"},{status:400});
 try{
   const result=await hubFetch("/v1/catalog/manual-save",{method:"POST",
     body:JSON.stringify({organizationId,productId:body.productId,
       expectedUpdatedAt:body.expectedUpdatedAt,proposed:body.proposed})});
   return NextResponse.json(result,{headers:{"cache-control":"no-store"}});
 }catch(error){
   const message=error instanceof Error?error.message:"manual_save_failed";
   return NextResponse.json({error:message},{status:message==="product_changed_reload"?409:400});
 }
}
