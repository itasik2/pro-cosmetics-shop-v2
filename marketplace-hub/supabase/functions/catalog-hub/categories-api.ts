import type postgres from "npm:postgres@3.4.7";
import { suggestCategories } from "./category-suggest.ts";
type Sql = ReturnType<typeof postgres>;
function reply(data: unknown, status=200) {
 return new Response(JSON.stringify(data), {status, headers:{"content-type":"application/json","cache-control":"no-store"}});
}
function required(value:unknown,key:string):string {
 if(typeof value!=="string"||!value.trim()||value.length>128) throw new Error("invalid_"+key);
 return value.trim();
}
export async function handleCategories(req:Request,route:string,url:URL,sql:Sql):Promise<Response|null> {
 if(!route.startsWith("/v1/categories")) return null;
 if(req.method!=="GET") return reply({error:"method_not_allowed"},405);
 let org:string;
 try { org=required(url.searchParams.get("organizationId"),"organizationId"); }
 catch { return reply({error:"invalid_organizationId"},400); }
 if(route==="/v1/categories") {
   const [categories,summary]=await Promise.all([
     sql`SELECT c."key",c."name",c."isActive",count(p."id")::int AS "productCount"
         FROM public."CatalogCategory" c
         LEFT JOIN public."Product" p ON p."organizationId"=c."organizationId"
           AND p."categoryKey"=c."key"
         WHERE c."organizationId"=${org}
         GROUP BY c."id",c."key",c."name",c."isActive" ORDER BY c."name"`,
     sql`SELECT count(*)::int AS "uncategorized"
         FROM public."Product" WHERE "organizationId"=${org}
         AND ("categoryKey" IS NULL OR "categoryKey"='' OR "categoryKey"='Без категории')`,
   ]);
   return reply({categories,uncategorized:Number(summary[0]?.uncategorized||0)});
 }
 if(route==="/v1/categories/unassigned") {
    const rows=await sql`SELECT "id","sku","title","brand","categoryKey"
      FROM public."Product"
      WHERE "organizationId"=${org}
        AND ("categoryKey" IS NULL OR "categoryKey"='' OR "categoryKey"='Без категории')
      ORDER BY "title" ASC LIMIT 100`;
    return reply(rows);
 }
 if(route==="/v1/categories/suggest") {
   let productId:string;
   try {productId=required(url.searchParams.get("productId"),"productId");}
   catch {return reply({error:"invalid_productId"},400);}
   const [products,categories]=await Promise.all([
     sql`SELECT "id","title","shortDescription","description","categoryKey"
       FROM public."Product" WHERE "organizationId"=${org} AND "id"=${productId} LIMIT 1`,
     sql`SELECT "key" FROM public."CatalogCategory"
       WHERE "organizationId"=${org} AND "isActive"=true`,
   ]);
   if(!products.length) return reply({error:"product_not_found"},404);
   return reply({productId,method:"RULES_V1",automaticallyApplied:false,
     suggestions:suggestCategories(products[0],categories.map(c=>String(c.key)))});
 }
 return reply({error:"not_found"},404);
}
