import {NextRequest,NextResponse} from "next/server";
import {organizationId} from "@/lib/hub";
import {isSameOrigin} from "@/lib/same-origin";
import {deleteLocalImportHistory} from "@/lib/local-supplier-store";

export const dynamic="force-dynamic";
export const runtime="nodejs";

export async function DELETE(request:NextRequest){
  const headers={"cache-control":"no-store"};
  if(process.env.CATALOG_HUB_LOCAL_MODE!=="true")
    return NextResponse.json({error:"local_mode_required"},{status:403,headers});
  if(!isSameOrigin(request))return NextResponse.json({error:"invalid_origin"},{status:403,headers});
  if(Number(request.headers.get("content-length")||0)>20000)
    return NextResponse.json({error:"payload_too_large"},{status:413,headers});
  const body:unknown=await request.json().catch(()=>null);
  const ids=body&&typeof body==="object"&&!Array.isArray(body)&&"ids" in body
    ?(body as {ids:unknown}).ids:null;
  if(!Array.isArray(ids))return NextResponse.json({error:"invalid_history_ids"},{status:400,headers});
  try{
    const deleted=await deleteLocalImportHistory(organizationId,ids);
    return NextResponse.json({deleted},{headers});
  }catch(e){
    return NextResponse.json({error:e instanceof Error?e.message:"history_delete_failed"},{status:400,headers});
  }
}
