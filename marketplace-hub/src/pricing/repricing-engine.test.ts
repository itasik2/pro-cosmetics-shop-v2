import test from "node:test";
import assert from "node:assert/strict";
import { calculateRepricing, profitFloor, type RepricingPolicyInput } from "./repricing-engine.js";

const rule: RepricingPolicyInput = {
  strategy:"UNDERCUT", minPrice:12000, maxPrice:25000,
  minMarginPercent:10, feePercent:10, shippingCost:500, targetProfit:500,
  step:10, maxChangePercent:20, maxAgeMinutes:30, cooldownMinutes:15, adjustment:10,
};
const quote = { id:"q1",seller:"seller-one",price:18000,observedAt:"2026-10-09T10:00:00.000Z",sourceType:"MANUAL" as const };
function calc(overrides: Record<string, unknown> = {}) {
 return calculateRepricing({rule,quotes:[quote],currentPrice:19000,purchasePrice:10000,mode:"DRY_RUN",autoEnabled:false,emergencyStop:false,now:"2026-10-09T10:05:00.000Z",...overrides});
}
test("profit floor includes fee, shipment, margin and target profit",()=>{
 assert.equal(profitFloor(10000,rule),13750);
});
test("simulates undercut within price and margin limits",()=>{
 const r=calc();
 assert.equal(r.status,"SIMULATED");
 assert.equal(r.targetPrice,17990);
 assert.equal(r.competitorPrice,18000);
});
test("won't offer below margin floor",()=>{
 const r=calc({quotes:[{...quote,price:12000}]});
 assert.equal(r.status,"BLOCKED");
 assert.equal(r.reason,"COMPETITOR_BELOW_FLOOR");
 assert.equal(r.targetPrice,null);
});
test("stale quote is ignored",()=>{
 assert.equal(calc({now:"2026-10-09T12:00:00.000Z"}).status,"NO_DATA");
});
test("manual quote never triggers automatic repricing",()=>{
 const r=calc({mode:"AUTO_PROPOSE",autoEnabled:true});
 assert.equal(r.status,"NO_DATA");
 assert.equal(r.reason,"NO_VERIFIED_QUOTES");
});
test("verified quote auto-proposes and emergency stop prevents it",()=>{
 const verified={...quote,sourceType:"VERIFIED_FEED" as const};
 assert.equal(calc({mode:"AUTO_PROPOSE",autoEnabled:true,quotes:[verified]}).status,"PROPOSED");
 assert.equal(calc({mode:"AUTO_PROPOSE",autoEnabled:true,quotes:[verified],emergencyStop:true}).reason,"EMERGENCY_STOP");
});
test("cooldown prevents price thrash",()=>{
 const verified={...quote,sourceType:"VERIFIED_FEED" as const};
 assert.equal(calc({mode:"AUTO_PROPOSE",autoEnabled:true,quotes:[verified],lastProposedAt:"2026-10-09T10:01:00Z"}).reason,"COOLDOWN");
});
test("max cycle delta clamps to permitted change",()=>{
 const r=calc({rule:{...rule,maxChangePercent:5},currentPrice:24000});
 assert.equal(r.status,"SIMULATED");
 assert.equal(r.targetPrice,22800);
 assert.ok(Math.abs(r.targetPrice!-24000)/24000<=.05);
});
test("invalid cost blocks all repricing",()=>{
 assert.equal(calc({purchasePrice:null}).reason,"COST_OR_MARGIN_UNKNOWN");
});
test("candidate above max remains bounded",()=>{
 const r=calc({quotes:[{...quote,price:100000}],currentPrice:24000});
 assert.equal(r.status,"SIMULATED");
 assert.equal(r.targetPrice,25000);
});
test("no proposed prices when min exceeds max",()=>{
 assert.equal(calc({rule:{...rule,minPrice:27000}}).reason,"INVALID_POLICY");
});
