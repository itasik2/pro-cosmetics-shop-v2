import { NextRequest, NextResponse } from "next/server";
import { hubFetch, organizationId } from "@/lib/hub";
import { isSameOrigin } from "@/lib/same-origin";
import { isLocalReadOnly } from "@/lib/local-mode";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({error:"invalid_origin"},{status:403});
  if (isLocalReadOnly()) return NextResponse.json({error:"local_read_only_mode"},{status:403});
  const input = await request.json().catch(() => null);
  if (!input || typeof input.productId !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.productId) ||
    typeof input.sourceUrl !== "string" || input.sourceUrl.length > 2048)
    return NextResponse.json({error:"invalid_media_request"},{status:400});
  let url: URL;
  try { url = new URL(input.sourceUrl); }
  catch { return NextResponse.json({error:"invalid_image_url"},{status:400}); }
  if (!["http:","https:"].includes(url.protocol) || url.username || url.password || url.port)
    return NextResponse.json({error:"invalid_image_url"},{status:400});

  try {
    const result = await hubFetch<{media:{variants:Array<{id:string;url:string;preset:string}>}}>("/v1/media/products/" +
      encodeURIComponent(input.productId) + "/import", {
        method: "POST",
        body: JSON.stringify({
          organizationId, sourceUrl: url.href,
          profileCodes: ["storefront","marketplace-square"], makePrimary: false,
        }),
      });
    return NextResponse.json(result,{headers:{"cache-control":"no-store"}});
  } catch (error) {
    return NextResponse.json({error:error instanceof Error ? error.message : "media_import_failed"},{status:400});
  }
}
