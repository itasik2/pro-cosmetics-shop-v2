import type postgres from "npm:postgres@3.4.7";
import { calculateRepricing, type CompetitorQuote, type RepricingPolicyInput } from "./repricing-engine.ts";
type Sql = ReturnType<typeof postgres>;
function json(data: unknown, status=200) { return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}}); }
function bad(error:string, status=400): never { throw Object.assign(new Error(error),{status}); }
function text(v:unknown,key:string,max=128):string { if(typeof v!=="string"||!v.trim()||v.length>max) bad("invalid_"+key); return v as string; }
function nat(v:unknown,key:string,min=0,max=1000000000):number { if(typeof v!=="number"||!Number.isSafeInteger(v)||v<min||v>max) bad("invalid_"+key); return v as number; }
function percent(v:unknown,key:string,min=0,max=99):number { if(typeof v!=="number"||!Number.isFinite(v)||v<min||v>max) bad("invalid_"+key); return v as number; }
function boolean(v:unknown,key:string):boolean { if(typeof v!=="boolean") bad("invalid_"+key); return v as boolean; }
async function parse(req:Request):Promise<Record<string,unknown>> { if(Number(req.headers.get("content-length")||0)>30000) bad("too_large",413); const o=await req.json().catch(()=>null); if(!o||typeof o!=="object"||Array.isArray(o)) bad("invalid_body"); return o as Record<string,unknown>; }
function channel(v:unknown) { const c=text(v,"channel"); if(!["STORE","KASPI","OZON","WILDBERRIES"].includes(c)) bad("invalid_channel"); return c; }
async function verifyProduct(sql:Sql,org:string,id:string) { const x=await sql`SELECT 1 FROM public."Product" WHERE "id"=${id} AND "organizationId"=${org} LIMIT 1`; if(!x.length) bad("product_not_found",404); }
export async function handleRepricing(req:Request, route:string, url:URL, sql:Sql):Promise<Response|null> {
 if(!route.startsWith("/v1/repricing/")) return null;
 try {
  if(route==="/v1/repricing/overview"&&req.method==="GET"){
   const org=text(url.searchParams.get("organizationId"),"organizationId");
   const [policies,observations,decisions]=await Promise.all([
    sql`SELECT r.*,p."sku",p."title",p."purchasePrice",p."basePrice" FROM public."ChannelRepricingPolicy" r JOIN public."Product" p ON p."id"=r."productId" AND p."organizationId"=r."organizationId" WHERE r."organizationId"=${org} ORDER BY r."updatedAt" DESC LIMIT 100`,
    sql`SELECT * FROM public."CompetitorPriceObservation" WHERE "organizationId"=${org} ORDER BY "createdAt" DESC LIMIT 100`,
    sql`SELECT * FROM public."RepricingDecision" WHERE "organizationId"=${org} ORDER BY "createdAt" DESC LIMIT 100`,
   ]);
   return json({policies,observations,decisions,capabilities:{verifiedCompetitorFeed:false,directMarketplacePublish:false,manualQuotesAuto:false}});
  }
  if(route==="/v1/repricing/policies"&&req.method==="POST") {
    const o=await parse(req); const org=text(o.organizationId,"organizationId"); const id=text(o.productId,"productId");
    const ch=channel(o.channel);const strategy=text(o.strategy,"strategy");
    if(!["UNDERCUT","MATCH","TARGET"].includes(strategy))bad("invalid_strategy");
    const mode=text(o.mode,"mode");if(!["DRY_RUN","AUTO_PROPOSE"].includes(mode))bad("invalid_mode");
    const enabled=boolean(o.enabled,"enabled"),stop=boolean(o.emergencyStop,"emergencyStop");
    const min=nat(o.minPrice,"minPrice",1),max=nat(o.maxPrice,"maxPrice",min);
    const margin=percent(o.minMarginPercent,"minMarginPercent"),fee=percent(o.feePercent,"feePercent");
    if(margin+fee>=100)bad("margin_plus_fee_invalid");
    const shipping=nat(o.shippingCost,"shippingCost"),profit=nat(o.targetProfit,"targetProfit");
    const step=nat(o.step,"step",1,1000000),adjust=nat(o.adjustment,"adjustment",0,1000000);
    const delta=percent(o.maxChangePercent,"maxChangePercent",.01,100);
    const age=nat(o.maxAgeMinutes,"maxAgeMinutes",1,10080),cooldown=nat(o.cooldownMinutes,"cooldownMinutes",0,10080);
    const offer=o.currentOfferPrice==null?null:nat(o.currentOfferPrice,"currentOfferPrice",1);
    if(ch!=="STORE"&&offer==null)bad("offer_price_required");
    await verifyProduct(sql,org,id);
    const rows=await sql`INSERT INTO public."ChannelRepricingPolicy"
      ("organizationId","productId","channel","strategy","mode","enabled","emergencyStop",
       "currentOfferPrice","minPrice","maxPrice","minMarginPercent","feePercent",
       "shippingCost","targetProfit","step","adjustment","maxChangePercent","maxAgeMinutes","cooldownMinutes")
       VALUES (${org},${id},${ch},${strategy},${mode},${enabled},${stop},${offer},${min},${max},
       ${margin},${fee},${shipping},${profit},${step},${adjust},${delta},${age},${cooldown})
       ON CONFLICT ("organizationId","productId","channel") DO UPDATE SET
       "strategy"=EXCLUDED."strategy","mode"=EXCLUDED."mode","enabled"=EXCLUDED."enabled",
       "emergencyStop"=EXCLUDED."emergencyStop","currentOfferPrice"=EXCLUDED."currentOfferPrice",
       "minPrice"=EXCLUDED."minPrice","maxPrice"=EXCLUDED."maxPrice",
       "minMarginPercent"=EXCLUDED."minMarginPercent","feePercent"=EXCLUDED."feePercent",
       "shippingCost"=EXCLUDED."shippingCost","targetProfit"=EXCLUDED."targetProfit",
       "step"=EXCLUDED."step","adjustment"=EXCLUDED."adjustment",
       "maxChangePercent"=EXCLUDED."maxChangePercent","maxAgeMinutes"=EXCLUDED."maxAgeMinutes",
       "cooldownMinutes"=EXCLUDED."cooldownMinutes","updatedAt"=now() RETURNING *`;
    return json(rows[0],201);
  }
  if(route==="/v1/repricing/observations"&&req.method==="POST"){
    const o=await parse(req);const org=text(o.organizationId,"organizationId");const id=text(o.productId,"productId");
    const ch=channel(o.channel),seller=text(o.seller,"seller",120),price=nat(o.price,"price",1);
    if(o.sourceType && o.sourceType!=="MANUAL")bad("trusted_source_requires_connector",403);
    await verifyProduct(sql,org,id);
    const rows=await sql`INSERT INTO public."CompetitorPriceObservation"
      ("organizationId","productId","channel","seller","price","sourceType","observedAt")
      VALUES (${org},${id},${ch},${seller},${price},'MANUAL',now()) RETURNING *`;
    return json(rows[0],201);
  }
  if(route==="/v1/repricing/evaluate"&&req.method==="POST") {
    const o=await parse(req),org=text(o.organizationId,"organizationId"),id=text(o.productId,"productId"),ch=channel(o.channel);
    const mode=o.auto===true?"AUTO_PROPOSE":"DRY_RUN";
    const policies=await sql`SELECT r.*,p."purchasePrice",p."basePrice" FROM public."ChannelRepricingPolicy" r
      JOIN public."Product" p ON p."id"=r."productId" AND p."organizationId"=r."organizationId"
      WHERE r."organizationId"=${org} AND r."productId"=${id} AND r."channel"=${ch} LIMIT 1`;
    if(!policies.length)bad("policy_not_found",404);
    const p=policies[0];
    const quotes=await sql`SELECT "id","seller","price","observedAt","sourceType" FROM public."CompetitorPriceObservation"
       WHERE "organizationId"=${org} AND "productId"=${id} AND "channel"=${ch}
       AND "observedAt" >= now() - interval '7 days' ORDER BY "price" ASC,"observedAt" DESC LIMIT 200`;
    const last=await sql`SELECT "createdAt" FROM public."RepricingDecision" WHERE "policyId"=${p.id}
      AND "status"='PROPOSED' ORDER BY "createdAt" DESC LIMIT 1`;
    const now=new Date().toISOString();
    const current=ch==="STORE"?Number(p.basePrice??p.currentOfferPrice):Number(p.currentOfferPrice);
    const safeCurrent=p.currentOfferPrice==null&&ch!=="STORE"?null:
      Number.isSafeInteger(current)&&current>0?current:null;
    const rule:RepricingPolicyInput={
      strategy:p.strategy, minPrice:Number(p.minPrice),maxPrice:Number(p.maxPrice),
      minMarginPercent:Number(p.minMarginPercent),feePercent:Number(p.feePercent),
      shippingCost:Number(p.shippingCost),targetProfit:Number(p.targetProfit),
      step:Number(p.step),adjustment:Number(p.adjustment),
      maxChangePercent:Number(p.maxChangePercent),maxAgeMinutes:Number(p.maxAgeMinutes),
      cooldownMinutes:Number(p.cooldownMinutes),
    };
    const result=calculateRepricing({
      rule,quotes:quotes.map(q=>({id:String(q.id),seller:String(q.seller),price:Number(q.price),
        observedAt:new Date(q.observedAt).toISOString(),sourceType:q.sourceType as CompetitorQuote["sourceType"]})),
      currentPrice:safeCurrent,purchasePrice:p.purchasePrice==null?null:Number(p.purchasePrice),
      mode,autoEnabled:Boolean(p.enabled),emergencyStop:Boolean(p.emergencyStop),
      lastProposedAt:last[0]?.createdAt?new Date(last[0].createdAt).toISOString():null,now,
    });
    const written=await sql`INSERT INTO public."RepricingDecision" ("organizationId","policyId","productId",
      "channel","mode","status","reason","currentPrice","competitorPrice","candidate","floorPrice",
      "targetPrice","observationIds","ruleSnapshot") VALUES
      (${org},${p.id},${id},${ch},${mode},${result.status},${result.reason},${safeCurrent},
      ${result.competitorPrice},${result.candidate},${result.floorPrice},${result.targetPrice},
      ${sql.json(result.observationIds)}::jsonb,${sql.json(rule)}::jsonb) RETURNING "id","createdAt"`;
    return json({...result,id:written[0].id,createdAt:written[0].createdAt});
  }
  return json({error:"not_found"},404);
 } catch(err){ const e=err as Error & {status?:number};
   if(e.status)return json({error:e.message},e.status);
   console.error("catalog_repricing_error",e);return json({error:"repricing_failed"},500);
 }
}
