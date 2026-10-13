#!/usr/bin/env node
/**
 * Real HTTP regression for PDF.js fake-worker resolution in Next.js.
 *
 * Uses a completely synthetic one-page PDF with selectable text, never an
 * actual supplier's document. The format is intentionally not a product
 * booklet: PDF.js must load and parse its text layer before the importer
 * responds with "pdf_card_layout_not_detected".
 */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const values={};
for(const line of readFileSync(resolve(root,"catalog-hub-web/.env.local"),"utf8").split(/\r?\n/)){
 if(line.startsWith("#")||!line.includes("="))continue;
 const sep=line.indexOf("=");
 values[line.slice(0,sep)]=line.slice(sep+1);
}
assert.equal(values.CATALOG_HUB_API_URL,"http://127.0.0.1:8000",
 "Refusing remote API URL for synthetic PDF smoke");
assert.equal(values.CATALOG_HUB_LOCAL_MODE,"true");
assert.ok(values.CATALOG_HUB_UI_PASSWORD,"UI password required");

function syntheticPdf(){
 const chunks=["%PDF-1.4\n"];
 const locations=[0];
 const object=(num,source)=>{
  locations[num]=Buffer.byteLength(chunks.join(""));
  chunks.push(num+" 0 obj\n"+source+"\nendobj\n");
 };
 const content="BT /F1 12 Tf 44 740 Td (This synthetic catalog text is not a supplier price list.) Tj ET";
 object(1,"<< /Type /Catalog /Pages 2 0 R >>");
 object(2,"<< /Type /Pages /Count 1 /Kids [3 0 R] >>");
 object(3,"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 843] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>");
 object(4,"<< /Length "+Buffer.byteLength(content)+" >>\nstream\n"+content+"\nendstream");
 object(5,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
 const start=Buffer.byteLength(chunks.join(""));
 chunks.push("xref\n0 6\n0000000000 65535 f \n");
 for(let i=1;i<=5;i++)chunks.push(String(locations[i]).padStart(10,"0")+" 00000 n \n");
 chunks.push("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"+start+"\n%%EOF\n");
 return new File([Buffer.from(chunks.join(""))],"synthetic-text.pdf",{type:"application/pdf"});
}
const base="http://127.0.0.1:3001";
const login=await fetch(base+"/api/session",{
 method:"POST",headers:{"content-type":"application/json"},
 body:JSON.stringify({password:values.CATALOG_HUB_UI_PASSWORD}),
 signal:AbortSignal.timeout(15000),
});
assert.equal(login.status,200,"Local session login failed");
const cookie=login.headers.get("set-cookie")?.split(";")[0]||"";
assert.ok(cookie.startsWith("catalog_hub_session="));
const form=new FormData();
form.set("file",syntheticPdf());
form.set("action","preview");
const response=await fetch(base+"/api/import",{
 method:"POST",headers:{origin:base,cookie},body:form,
 signal:AbortSignal.timeout(40000),
});
const payload=await response.json().catch(()=>null);
assert.equal(response.status,400,"Expected unsupported synthetic PDF layout, got "+JSON.stringify(payload));
assert.match(String(payload?.error||""),/^pdf_card_layout_not_detected/,
 "PDF.js worker failed or file could not be parsed: "+JSON.stringify(payload));
console.log("PASS: Next.js server parsed a PDF text layer; PDF.js fake worker resolved.");
console.log("Unsupported layout rejected, no products or stock changed.");
