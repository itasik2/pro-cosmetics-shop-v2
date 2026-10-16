import {NextRequest,NextResponse} from "next/server";
import {isSameOrigin} from "@/lib/same-origin";
import {extractJeudermEmbeddedImages} from "@/lib/pdf-jeuderm-images";

export const runtime="nodejs";
export const dynamic="force-dynamic";
function fail(message:string,status=400){
 return NextResponse.json({error:message},{status,headers:{"cache-control":"no-store"}});
}
export async function POST(request:NextRequest){
 if(process.env.CATALOG_HUB_LOCAL_MODE!=="true")
   return fail("pdf_images_local_mode_only",403);
 if(!isSameOrigin(request))return fail("invalid_origin",403);
 if(Number(request.headers.get("content-length")||0)>9*1024*1024)
   return fail("pdf_file_size_limit_8mb",413);
 let form:FormData;
 try{form=await request.formData();}catch{return fail("invalid_form_data");}
 const file=form.get("file"),pageRaw=form.get("page");
 if(!(file instanceof File)||!file.name.toLowerCase().endsWith(".pdf"))
   return fail("pdf_required");
 if(file.size<20||file.size>8*1024*1024)return fail("pdf_file_size_limit_8mb",413);
 if(typeof pageRaw!=="string"||!/^([1-9]|[12][0-9]|30)$/.test(pageRaw))
   return fail("invalid_pdf_page");
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(new TextDecoder().decode(bytes.subarray(0,8)).indexOf("%PDF-")<0)
   return fail("invalid_pdf_signature");
 try{
  const page=Number(pageRaw);
  const items=extractJeudermEmbeddedImages(bytes,page).get(page)||[];
  // Inline previews are intentionally ephemeral: no media storage and no
  // automatic association with products. Cap response memory and bandwidth.
  const images:Array<{visualIndex:number;url:string;width:number;height:number}>=[];
  let totalBytes=0;
  for(const item of items){
   const estimated=Buffer.byteLength(item.dataBase64,"base64");
   if(images.length>=12||totalBytes+estimated>2_500_000)break;
   images.push({
    visualIndex:item.visualIndex,
    url:"data:"+item.mimeType+";base64,"+item.dataBase64,
    width:item.width,height:item.height,
   });
   totalBytes+=estimated;
  }
  return NextResponse.json({
   page,images,totalFound:items.length,partial:images.length<items.length,
   note:"Фотографии для визуального сравнения. Сопоставление с карточками по расположению не подтверждено.",
  },{headers:{"cache-control":"no-store"}});
 }catch(e){
  return fail(e instanceof Error?e.message:"pdf_image_preview_failed");
 }
}
