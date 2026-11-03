import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {canonical} from "../../marketplace-hub/supabase/functions/catalog-hub/core-domain";
import {verifyChannelSignature} from "../../marketplace-hub/supabase/functions/catalog-hub/channel-signature";
const secret="synthetic-test-only-32-byte-secret-value",now=Date.UTC(2026,10,3,12),timestamp=String(now/1000);
const body={externalEventId:"event-1",externalOrderId:"order-1",type:"CREATED",items:[{sellerSku:"SKU1",externalWarehouseId:"STORE1",quantity:1}]};
const signature="v1="+createHmac("sha256",secret).update(timestamp+".channel_a."+canonical(body)).digest("hex");
test("signed order events bind payload, channel and timestamp with canonical JSON",async()=>{
 await verifyChannelSignature({secret,connectionId:"channel_a",timestamp,signature,body,now});
 for(const patch of [{body:{...body,type:"SHIPPED"}},{connectionId:"channel_b"},{signature:"v1="+"0".repeat(64)}]){
  await assert.rejects(verifyChannelSignature({secret,connectionId:"channel_a",timestamp,signature,body,now,...patch}),/channel_signature_invalid/);
 }
});
test("old and future signed events expire; an unconfigured secret never authenticates",async()=>{
 for(const changedNow of [now+300001,now-300001])await assert.rejects(verifyChannelSignature({secret,connectionId:"channel_a",timestamp,signature,body,now:changedNow}),/channel_signature_expired/);
 await assert.rejects(verifyChannelSignature({secret:"",connectionId:"channel_a",timestamp,signature,body,now}),/channel_signing_not_configured/);
});
