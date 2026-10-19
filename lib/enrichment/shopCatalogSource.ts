import "server-only";
import { prisma } from "@/lib/prisma";
import { findVariantBySku, normalizeStoredVariants } from "@/lib/price-import/productVariants";

type Identity={sku:string;brand?:string;volumeValue?:number;volumeUnit?:string};
function unit(value:string){const normalized=value.toLocaleLowerCase("ru-RU").replace(/\.$/,"");
  return ({"мл":"ml","гр":"g","г":"g","шт":"pcs"} as Record<string,string>)[normalized]||normalized;}

export async function findShopCatalogSource(product:Identity){
  if(!product.brand||!product.sku||!process.env.DATABASE_URL)return null;
  let candidates=await prisma.product.findMany({
    where:{supplierSku:{equals:product.sku,mode:"insensitive"},enrichmentStatus:{not:"MERGED"}},
    take:3,select:{slug:true,brand:{select:{name:true}},shortDescription:true,
      description:true,image:true,volumeValue:true,volumeUnit:true,
      images:{select:{url:true,isPrimary:true}},variants:true},
  });
  let variantImage:string|undefined;
  let variantMatch=false;
  if(candidates.length===0){
    const family=await prisma.product.findMany({
      where:{brand:{name:{equals:product.brand,mode:"insensitive"}},enrichmentStatus:{not:"MERGED"}},
      take:300,select:{slug:true,brand:{select:{name:true}},shortDescription:true,
        description:true,image:true,volumeValue:true,volumeUnit:true,
        images:{select:{url:true,isPrimary:true}},variants:true},
    });
    const matching=family.map(candidate=>({candidate,
      variant:findVariantBySku(normalizeStoredVariants(candidate.variants),product.sku)}))
      .filter(row=>Boolean(row.variant));
    if(matching.length!==1)return null;
    candidates=[matching[0].candidate];
    variantMatch=true;
    variantImage=matching[0].variant?.image;
    const label=matching[0].variant?.label||"";
    const amount=label.match(/(\d+(?:[.,]\d+)?)\s*(мл|ml|гр|г|g|шт)/iu);
    if(product.volumeValue&&amount&&Number(amount[1].replace(",","."))!==product.volumeValue)return null;
    if(product.volumeUnit&&amount&&unit(product.volumeUnit)!==unit(amount[2]))return null;
  }
  if(candidates.length!==1)return null;
  const match=candidates[0];
  if(match.brand?.name.trim().toLocaleLowerCase("ru-RU")!==product.brand.trim().toLocaleLowerCase("ru-RU"))return null;
  if(!variantMatch&&product.volumeValue&&match.volumeValue&&product.volumeValue!==match.volumeValue)return null;
  if(!variantMatch&&product.volumeUnit&&match.volumeUnit&&unit(product.volumeUnit)!==unit(match.volumeUnit))return null;
  const description=match.description?.trim()==="Описание готовится"?"":match.description?.trim()||"";
  const images=variantMatch?[variantImage]:[match.image,...match.images.filter(image=>image.isPrimary).map(image=>image.url),
    ...match.images.filter(image=>!image.isPrimary).map(image=>image.url)]
    .filter((url):url is string=>typeof url==="string"&&/^https:\/\/[^ ]+$/i.test(url));
  if(!description&&!match.shortDescription?.trim()&&!images.length)return null;
  return {sourceUrl:"https://www.procosmetics.kz/shop/"+encodeURIComponent(match.slug),
    sourceType:"procosmetics_catalog",confidence:100,
    fields:{shortDescription:match.shortDescription?.trim().slice(0,280)||"",
      description:description.slice(0,12000),application:"",ingredients:""},
    images:[...new Set(images)].slice(0,8),warnings:["existing_shop_data_review_required"]};
}
