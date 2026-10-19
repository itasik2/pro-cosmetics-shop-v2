export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminGuard";
import { prisma } from "@/lib/prisma";
import { getCatalogHubShadowConfig, getCatalogHubSnapshot, type CatalogHubSnapshotItem } from "@/lib/catalogHubClient";
import { planCatalogHubPull } from "@/lib/catalogHubPullPlan";

async function state(){
  const config=getCatalogHubShadowConfig();
  if(!config.configured)throw new Error("catalog_hub_not_configured");
  const snapshot=await getCatalogHubSnapshot();
  const products=await prisma.product.findMany({where:{supplierSku:{not:null},enrichmentStatus:{not:"MERGED"}},
    select:{id:true,supplierSku:true,brand:{select:{name:true}},name:true,updatedAt:true,
      shortDescription:true,description:true,image:true,category:true,price:true,sourcePrice:true}});
  return {snapshot,products};
}

function match(hub:CatalogHubSnapshotItem,products:Awaited<ReturnType<typeof state>>["products"]){
  const candidates=products.filter(p=>p.supplierSku?.trim().toUpperCase()===hub.sku.trim().toUpperCase());
  if(candidates.length!==1)return null;
  const product=candidates[0];
  if(!hub.brand||!product.brand?.name||hub.brand.trim().toLocaleLowerCase("ru-RU")!==
    product.brand.name.trim().toLocaleLowerCase("ru-RU"))return null;
  return product;
}

export async function GET(){
  const forbidden=await requireAdmin();if(forbidden)return forbidden;
  try{
    const {snapshot,products}=await state();
    return NextResponse.json({total:snapshot.items.length,items:snapshot.items.map(hub=>{
      const local=match(hub,products);
      return {sku:hub.sku,title:hub.title,hubUpdatedAt:hub.updatedAt,
        localId:local?.id||null,localUpdatedAt:local?.updatedAt.toISOString()||null,
        status:local?"MATCH":"REVIEW_MATCH",
        before:local?{shortDescription:local.shortDescription,description:local.description,image:local.image,
          category:local.category,price:local.price,sourcePrice:local.sourcePrice}:null,
        changes:local?planCatalogHubPull(hub,local):{},
        priceChange:local?planCatalogHubPull(hub,local,true).price??null:null,
        purchaseChange:local?planCatalogHubPull(hub,local,true).sourcePrice??null:null};
    })},{headers:{"cache-control":"no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"pull_failed"},{status:502});}
}

export async function POST(request:Request){
  const forbidden=await requireAdmin();if(forbidden)return forbidden;
  if(request.headers.get("origin")!==new URL(request.url).origin)
    return NextResponse.json({error:"invalid_origin"},{status:403});
  const body=await request.json().catch(()=>null);
  if(!body||body.confirmed!==true||typeof body.sku!=="string"||body.sku.length>128||
    typeof body.localUpdatedAt!=="string"||typeof body.hubUpdatedAt!=="string"||
    typeof body.updatePrices!=="boolean")return NextResponse.json({error:"invalid_request"},{status:400});
  try{
    const {snapshot,products}=await state();
    const hub=snapshot.items.find(p=>p.sku===body.sku);
    if(!hub||hub.updatedAt!==body.hubUpdatedAt)return NextResponse.json({error:"hub_changed_refresh_preview"},{status:409});
    const local=match(hub,products);
    if(!local||local.updatedAt.toISOString()!==body.localUpdatedAt)
      return NextResponse.json({error:"shop_changed_refresh_preview"},{status:409});
    const changes=planCatalogHubPull(hub,local,body.updatePrices);
    if(!Object.keys(changes).length)return NextResponse.json({error:"no_changes"},{status:409});
    const result=await prisma.product.updateMany({where:{id:local.id,updatedAt:local.updatedAt},data:changes});
    if(result.count!==1)return NextResponse.json({error:"shop_changed_refresh_preview"},{status:409});
    return NextResponse.json({updated:true,fields:Object.keys(changes)},{headers:{"cache-control":"no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"pull_failed"},{status:502});}
}
