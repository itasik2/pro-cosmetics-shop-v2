import {NextRequest,NextResponse} from "next/server";
import {organizationId} from "@/lib/hub";
import {
  deleteSupplierProfile,listLocalImportHistory,listSupplierProfiles,saveSupplierProfile
} from "@/lib/local-supplier-store";

export const dynamic="force-dynamic";
export const runtime="nodejs";
function send(data:unknown,status=200){
  return NextResponse.json(data,{status,headers:{"cache-control":"no-store"}});
}
function enabled(){
  return process.env.CATALOG_HUB_LOCAL_MODE==="true";
}
function errorMessage(e:unknown){
  return e instanceof Error?e.message:"local_profile_operation_failed";
}
function validOrigin(request:NextRequest){
  return request.headers.get("origin")===request.nextUrl.origin;
}
export async function GET(){
  if(!enabled())return send({error:"local_mode_required"},403);
  try{
    const [profiles,history]=await Promise.all([
      listSupplierProfiles(organizationId),
      listLocalImportHistory(organizationId),
    ]);
    return send({profiles,history,storage:"LOCAL_ONLY"});
  }catch(e){return send({error:errorMessage(e)},500);}
}
export async function POST(request:NextRequest){
  if(!enabled())return send({error:"local_mode_required"},403);
  if(!validOrigin(request))return send({error:"invalid_origin"},403);
  if(Number(request.headers.get("content-length")||0)>12000)return send({error:"payload_too_large"},413);
  const raw:unknown=await request.json().catch(()=>null);
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return send({error:"invalid_body"},400);
  const body=raw as Record<string,unknown>;
  try{
    const profile=await saveSupplierProfile({
      organizationId,
      id:typeof body.id==="string"?body.id:undefined,
      name:body.name,notes:body.notes,
      mapping:body.mapping,
    });
    return send({profile},201);
  }catch(e){return send({error:errorMessage(e)},400);}
}
export async function DELETE(request:NextRequest){
  if(!enabled())return send({error:"local_mode_required"},403);
  if(!validOrigin(request))return send({error:"invalid_origin"},403);
  const raw:unknown=await request.json().catch(()=>null);
  if(!raw||typeof raw!=="object"||Array.isArray(raw))return send({error:"invalid_body"},400);
  const id=(raw as Record<string,unknown>).id;
  if(typeof id!=="string")return send({error:"invalid_profile_id"},400);
  try{
    const found=await deleteSupplierProfile(organizationId,id);
    return found?send({deleted:true}):send({error:"profile_not_found"},404);
  }catch(e){return send({error:errorMessage(e)},400);}
}
