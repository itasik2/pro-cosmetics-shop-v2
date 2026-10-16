import test from "node:test";
import assert from "node:assert/strict";
import {deflateSync} from "node:zlib";
import {extractJeudermEmbeddedImages} from "./pdf-jeuderm-images";

function fakePdfWithImages(width=100,height=100){
 const rgb=Buffer.alloc(width*height*3,120);
 const stream=deflateSync(rgb);
 const before=Buffer.from(
  "%PDF-1.4\n"+
  "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"+
  "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"+
  "3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /XObject << /Image1 4 0 R >> >> >>\nendobj\n"+
  "4 0 obj\n<< /Type /XObject /Subtype /Image /ColorSpace /DeviceRGB /Width "+width+" /Height "+height+
    " /BitsPerComponent 8 /Filter /FlateDecode /Length "+stream.length+" >>\nstream\n");
 const after=Buffer.from("\nendstream\nendobj\n%%EOF\n");
 return Buffer.concat([before,stream,after]);
}
test("reuses ProCosmetics embedded image parser for page previews",()=>{
 const doc=fakePdfWithImages();
 const results=extractJeudermEmbeddedImages(doc,1).get(1)||[];
 assert.equal(results.length,1);
 assert.equal(results[0].mimeType,"image/png");
 assert.equal(results[0].width,100);
 assert.equal(results[0].height,100);
 assert.deepEqual(Buffer.from(results[0].dataBase64,"base64").subarray(0,8),
  Buffer.from([137,80,78,71,13,10,26,10]));
 assert.equal(extractJeudermEmbeddedImages(doc,2).size,0);
});
test("safety limits ignore overlarge image dimensions and pdf payloads",()=>{
 assert.deepEqual(extractJeudermEmbeddedImages(fakePdfWithImages(2000,2000),1).get(1),[]);
 assert.throws(()=>extractJeudermEmbeddedImages(Buffer.alloc(8*1024*1024+1)),/pdf_file_size_limit_8mb/);
});
