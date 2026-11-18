// Synthetic records only. Shared by isolated PostgreSQL CI and local development.
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";

export async function runReservationChecks({baseUrl="http://127.0.0.1:8000",key,keyB,readOnlyKey}) {
  assert.equal(new URL(baseUrl).hostname,"127.0.0.1");
  assert.equal(new URL(baseUrl).protocol,"http:");
  let checks=0;
  const suffix=randomUUID().slice(0,8),warehouseId="wh_pav_01",reason="Synthetic reservation acceptance";
  async function api(path,{body,credential=key,idempotencyKey=randomUUID()}={}) {
    const response=await fetch(baseUrl+"/v1/"+path,{signal:AbortSignal.timeout(15000),headers:{"x-catalog-hub-key":credential,
      ...(body?{"content-type":"application/json","idempotency-key":idempotencyKey}:{})},
      ...(body?{method:"POST",body:JSON.stringify(body)}:{})});
    return {status:response.status,data:await response.json()};
  }
  function expect(reply,status,label) {assert.equal(reply.status,status,label+": "+JSON.stringify(reply.data));checks++;return reply.data;}
  function equal(actual,expected) {assert.deepEqual(actual,expected);checks++;}
  async function product(name,quantity=0,credential=key,warehouse=warehouseId) {
    const p=expect(await api("catalog/products",{credential,body:{card:{sku:"RES-"+name+"-"+suffix,title:"Synthetic reservation "+name,purchasePrice:100,price:200}}}),201,"create test product");
    if(quantity)expect(await api("inventory/movements",{credential,body:{productId:p.id,warehouseId:warehouse,kind:"RECEIVE",quantity,expectedRevision:0,reason}}),201,"receive stock");
    return p.id;
  }
  async function stock(productId) {
    return expect(await api("inventory/balances?productId="+productId),200,"read stock").items.find(item=>item.warehouseId===warehouseId)||{onHand:0,reserved:0,revision:0};
  }
  async function createBody(productId,quantity=1,reference="RES-"+randomUUID()) {
    return {reference,reason,confirmed:true,items:[{productId,warehouseId,quantity,expectedRevision:(await stock(productId)).revision}]};
  }
  async function action(reservation,operation,items,extra={}) {
    return api(`reservations/${reservation.id}/${operation}`,{body:{confirmed:true,reason,expectedVersion:reservation.version,...(items?{items}:{}),...extra}});
  }
  async function reconcile(productId) {return expect(await api("inventory/reconciliation?productId="+productId),200,"reconcile all sources").items[0];}
  const p=await product("lifecycle",12),other=await product("second",4);
  const body=await createBody(p,8),operationKey=randomUUID();
  const initial=expect(await api("reservations",{body,idempotencyKey:operationKey}),201,"create reservation");
  equal([initial.version,initial.status,initial.items[0].remaining,initial.items[0].returnable],[1,"ACTIVE",8,0]);
  equal(["payloadHash","organizationId"].some(field=>field in initial),false);
  equal((await stock(p)).reserved,8);
  equal(expect(await api("reservations",{body,idempotencyKey:operationKey}),201,"same key retries safely"),initial);
  equal(expect(await api("reservations",{body:{...body,items:[{...body.items[0],expectedRevision:999}]} }),201,"same business reference survives new key and revision").id,initial.id);
  equal((await stock(p)).reserved,8);
  expect(await api("reservations",{body:{...body,items:[{...body.items[0],quantity:2}]}}),409,"business reference cannot change content");
  expect(await api("reservations",{body:{...body,reason:"Different reason"},idempotencyKey:operationKey}),409,"operation key cannot change body");
  expect(await api("reservations",{body:{...body,reference:"unconfirmed-"+suffix,confirmed:false}}),400,"confirmation is mandatory");
  for(const quantity of [0,-1,1.5,"1",100001])expect(await api("reservations",{body:{...body,items:[{...body.items[0],quantity}]}}),400,"invalid quantity rejected");
  expect(await api("reservations",{body:{...body,reference:"bad-reason-"+suffix,reason:"bad"}}),400,"reason minimum enforced");
  expect(await api("reservations",{body:{...body,reference:"x".repeat(129)}}),400,"reference bounded");
  expect(await api("reservations",{body:{...body,reference:"missing-revision-"+suffix,items:[{productId:p,warehouseId,quantity:1}]}}),400,"revision is mandatory");
  expect(await api("reservations",{body:{...body,reference:"stale-"+suffix}}),409,"stale stock rejected");
  expect(await api("reservations",{body,credential:readOnlyKey}),403,"catalog reader cannot reserve");
  expect(await api("reservations",{credential:readOnlyKey}),403,"catalog reader cannot read reservations");
  expect(await api("reservations",{body,credential:"inventory-only:"+readOnlyKey}),403,"inventory reader cannot reserve");
  equal(expect(await api("reservations/"+initial.id,{credential:"inventory-only:"+readOnlyKey}),200,"inventory scope reads own reservation").id,initial.id);
  expect(await api("reservations/"+initial.id,{credential:keyB}),404,"direct cross-tenant reservation rejected");
  expect(await action(initial,"ship",undefined,{organizationId:"org_core_b"}),403,"tenant override rejected");
  expect(await api("reservations/"+initial.id+"/release",{credential:keyB,body:{confirmed:true,reason,expectedVersion:1}}),404,"cross-tenant mutation rejected");
  const alien=await product("foreign",2,keyB,"wh_core_b");
  expect(await api("reservations",{body:{...body,reference:"foreign-product-"+suffix,items:[{productId:alien,warehouseId,quantity:1,expectedRevision:0}]}}),404,"foreign product rejected");
  expect(await api("reservations",{body:{...body,reference:"foreign-warehouse-"+suffix,items:[{productId:p,warehouseId:"wh_core_b",quantity:1,expectedRevision:0}]}}),404,"foreign warehouse rejected");
  expect(await api("reservations?status=INVALID"),400,"unknown list filter rejected");
  const before=await stock(p);
  const report=await reconcile(p);
  equal([report.reserved,report.expectedReserved,report.orderReserved,report.standaloneReserved,report.activeReservations,report.status],[8,8,0,8,1,"MATCH"]);
  const releaseItems=[{productId:p,warehouseId,quantity:2}];
  let hold=expect(await action(initial,"release",releaseItems),200,"partial release");
  equal([hold.version,hold.status,hold.items[0].released,hold.items[0].remaining],[2,"ACTIVE",2,6]);
  expect(await action(initial,"ship"),409,"stale reservation version rejected");
  expect(await action(hold,"ship",[{productId:other,warehouseId,quantity:1}]),409,"cannot ship unrelated item");
  expect(await action(hold,"ship",[{productId:p,warehouseId,quantity:7}]),409,"cannot exceed remaining reserve");
  const shipBody={confirmed:true,reason,expectedVersion:hold.version,items:[{productId:p,warehouseId,quantity:3}]},shipKey=randomUUID();
  hold=expect(await api(`reservations/${hold.id}/ship`,{body:shipBody,idempotencyKey:shipKey}),200,"partial shipment");
  equal([hold.status,hold.items[0].remaining,hold.items[0].shipped],["ACTIVE",3,3]);
  equal(expect(await api(`reservations/${hold.id}/ship`,{body:shipBody,idempotencyKey:shipKey}),200,"shipment response retry"),hold);
  equal([(await stock(p)).onHand,(await stock(p)).reserved],[before.onHand-3,3]);
  hold=expect(await action(hold,"return",[{productId:p,warehouseId,quantity:1}]),200,"return while partially reserved");
  equal([hold.status,hold.items[0].returned,hold.items[0].remaining],["ACTIVE",1,3]);
  hold=expect(await action(hold,"ship"),200,"ship all remaining");
  equal([hold.status,hold.items[0].remaining,hold.items[0].returnable],["PARTIALLY_RETURNED",0,5]);
  expect(await action(hold,"release"),409,"cannot release shipped items");
  expect(await action(hold,"return",[{productId:p,warehouseId,quantity:6}]),409,"cannot return more than shipped");
  hold=expect(await action(hold,"return"),200,"return all eligible items");
  equal([hold.status,hold.items[0].returned,hold.items[0].returnable],["RETURNED",6,0]);
  expect(await action(hold,"return"),409,"cannot return twice with new key");
  equal([(await stock(p)).onHand,(await stock(p)).reserved],[12,0]);
  equal(expect(await api("reservations",{body}),201,"retry terminal business reference").status,"RETURNED");
  equal((await stock(p)).reserved,0);
  equal((await reconcile(p)).expectedReserved,0);

  // Normalization, all-or-nothing multi-SKU changes and rollback of earlier items.
  const multi={reference:"MULTI-"+suffix,reason,confirmed:true,items:[
    {productId:p,warehouseId,quantity:1,expectedRevision:(await stock(p)).revision},
    {productId:other,warehouseId,quantity:2,expectedRevision:(await stock(other)).revision}]};
  const beforeMulti=await stock(p);
  expect(await api("reservations",{body:{...multi,items:[multi.items[0],{...multi.items[1],quantity:5}]}}),409,"multi-item reserve rolls back if one item lacks stock");
  equal(await stock(p),beforeMulti);
  const multiHold=expect(await api("reservations",{body:multi}),201,"same reference succeeds after rollback");
  expect(await action(multiHold,"ship",[{...multi.items[0]},{...multi.items[1],quantity:3}]),409,"partial action validates every item first");
  equal((await stock(p)).reserved,1);
  const multiShipped=expect(await action(multiHold,"ship"),200,"multi-item shipment");
  equal(multiShipped.status,"FULFILLED");
  equal(expect(await action(multiShipped,"return"),200,"multi-item return").status,"RETURNED");
  const duplicateBody=await createBody(other,1,"COMBINED-"+suffix);
  const dupItem=duplicateBody.items[0];
  expect(await api("reservations",{body:{...duplicateBody,items:[dupItem,{...dupItem,expectedRevision:dupItem.expectedRevision+1}]}}),400,"duplicate pair requires identical revisions");
  const combined=expect(await api("reservations",{body:{...duplicateBody,items:[dupItem,dupItem]}}),201,"duplicate pair normalized");
  equal([combined.items.length,combined.items[0].quantity],[1,2]);
  equal(expect(await action(combined,"release"),200,"full release").status,"RELEASED");

  // Competing reservations and order events use exactly the same Product locks.
  const last=await product("last",1),lastBody=await createBody(last);
  const competitors=await Promise.all([api("reservations",{body:lastBody}),api("reservations",{body:{...lastBody,reference:"RACE-"+suffix}})]);
  equal(competitors.map(reply=>reply.status).sort(),[201,409]);
  const winner=competitors.find(reply=>reply.status===201).data;
  equal((await stock(last)).reserved,1);
  const same=await product("dedup",2),sameBody=await createBody(same);
  const dedup=await Promise.all([api("reservations",{body:sameBody}),api("reservations",{body:sameBody})]);
  dedup.forEach(reply=>expect(reply,201,"concurrent business reference"));equal(dedup[0].data.id,dedup[1].data.id);equal((await stock(same)).reserved,1);
  const transitions=await Promise.all([action(winner,"ship"),action(winner,"release")]);
  equal(transitions.map(reply=>reply.status).sort(),[200,409]);
  equal((await stock(last)).reserved,0);
  const connection=expect(await api("channels",{body:{name:"Reservation race "+suffix,adapter:"OWN_STORE"}}),201,"create mixed-source channel");
  expect(await api(`channels/${connection.id}/mode`,{body:{mode:"ACTIVE",expectedVersion:connection.version,confirmed:true}}),200,"activate synthetic channel");
  const mixed=await product("mixed",3),mixedBody=await createBody(mixed);
  expect(await api("reservations",{body:mixedBody}),201,"standalone source");
  const event={connectionId:connection.id,externalOrderId:"MIXED-"+suffix,externalEventId:randomUUID(),type:"CREATED",items:[{productId:mixed,warehouseId,quantity:2}]};
  expect(await api("orders/events",{body:event}),200,"order shares stock");
  const mixedReport=await reconcile(mixed);
  equal([mixedReport.expectedReserved,mixedReport.orderReserved,mixedReport.standaloneReserved,mixedReport.activeOrders,mixedReport.activeReservations,mixedReport.status],[3,2,1,1,1,"MATCH"]);
  const raceProduct=await product("order-race",1),raceBody=await createBody(raceProduct);
  const orderRace=await Promise.all([api("reservations",{body:raceBody}),api("orders/events",{body:{...event,externalOrderId:randomUUID(),externalEventId:randomUUID(),items:[{productId:raceProduct,warehouseId,quantity:1}]}})]);
  equal(orderRace.filter(reply=>[200,201].includes(reply.status)).length,1);equal(orderRace.filter(reply=>reply.status===409).length,1);equal((await stock(raceProduct)).reserved,1);
  const list=expect(await api("reservations?limit=1"),200,"bounded list");equal(list.items.length,1);assert.ok(list.nextCursor);checks++;
  const next=expect(await api("reservations?limit=1&cursor="+encodeURIComponent(list.nextCursor)),200,"reservation cursor");assert.notEqual(next.items[0].id,list.items[0].id);checks++;
  equal(expect(await api("reservations",{credential:keyB}),200,"foreign tenant list").items.length,0);
  expect(await api("reservations/inactive-core-reservation/ship",{body:{confirmed:true,reason,expectedVersion:1}}),404,"inactive warehouse cannot ship");
  const releasedInactive=expect(await api("reservations/inactive-core-reservation/release",{body:{confirmed:true,reason,expectedVersion:1}}),200,"inactive warehouse reserve can be released");
  equal(releasedInactive.status,"RELEASED");
  console.log(`Standalone reservations: ${checks} synthetic API checks passed.`);
  return {checks};
}
