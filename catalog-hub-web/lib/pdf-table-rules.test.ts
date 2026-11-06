import test from "node:test";
import assert from "node:assert/strict";
import {extractNameCellRules} from "./pdf-table-rules";
const ops={save:1,restore:2,transform:3,setFillRGBColor:4,constructPath:5,rectangle:6,fill:7,eoFill:8};
test("white backgrounds cannot split a shared name cell",()=>{
  const rules=extractNameCellRules({fnArray:[4,5,7,4,5,7],argsArray:[
    [255,255,255],[[6],[88,700,142,20]],null,
    [0,0,0],[[6],[21,680,553,0.7]],null,
  ]},ops,595,842);
  assert.equal(rules.length,1);
  assert.ok(Math.abs(rules[0]-161.65)<0.01);
});
test("border geometry respects PDF graphics transforms",()=>{
  const rules=extractNameCellRules({fnArray:[1,3,4,5,7,2],argsArray:[null,[1,0,0,1,0,10],[0,0,0],[[6],[21,680,553,0.7]],null,null]},ops,595,842);
  assert.ok(Math.abs(rules[0]-151.65)<0.01);
});
