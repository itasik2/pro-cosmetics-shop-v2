import {NextRequest,NextResponse} from "next/server";
import {hubFetch,organizationId} from "@/lib/hub";
import {isSameOrigin} from "@/lib/same-origin";
export const dynamic="force-dynamic";
function send(body:unknown,status=200){return NextResponse.json(body,{status,headers:{"cache-control":"no-store"}});}
export async function GET(){
 try{return send(await hubFetch("/v1/suppliers?organizationId="+encodeURIComponent(organizationId)));}
 catch(e){return send({error:e instanceof Error?e.message:"suppliers_unavailable"},502);}
}
export async function POST(request:NextRequest){
 if(!isSameOrigin(request))return send({error:"invalid_origin"},403);
 const body=await request.json().catch(()=>null);
 if(!body||typeof body!=="object"||Array.isArray(body))return send({error:"invalid_body"},400);
 try{return send(await hubFetch("/v1/price-import/suppliers",{method:"POST",
  body:JSON.stringify({organizationId,name:body.name,code:body.code})}),201);}
 catch(e){return send({error:e instanceof Error?e.message:"supplier_create_failed"},400);}
}
