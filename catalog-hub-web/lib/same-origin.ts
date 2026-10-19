/**
 * CSRF origin verification for Next.js behind reverse proxies.
 * request.nextUrl.origin can be "localhost" even when the browser and Host
 * both address "127.0.0.1". Compare against the actual HTTP Host header,
 * and require the same external protocol.
 */
export function isSameOrigin(request: Pick<Request,"headers"|"url">): boolean {
 const raw=request.headers.get("origin");
 const host=request.headers.get("host");
 if(!raw||!host)return false;
 try{
   const origin=new URL(raw);
   if(origin.username||origin.password||origin.pathname!=="/"||origin.search||origin.hash)return false;
   if(origin.host.toLowerCase()!==host.toLowerCase())return false;
   const forwarded=request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
   const scheme=forwarded==="https"||forwarded==="http"?forwarded:new URL(request.url).protocol.slice(0,-1);
   return origin.protocol===scheme+":";
 }catch{return false;}
}
