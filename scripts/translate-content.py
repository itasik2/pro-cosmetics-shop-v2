#!/usr/bin/env python3
"""One-off offline localization job: stores translated copy in LocalizedContent.

No Google Translate, no translation at page-load time. Requires DATABASE_URL and
OPENAI_API_KEY supplied by the operator. Does not alter Product/Post source rows.

Usage:
  python3 scripts/translate-content.py --locale kk --kind product --limit 50 --publish
  python3 scripts/translate-content.py --locale en --kind post --publish
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

import psycopg

parser = argparse.ArgumentParser()
parser.add_argument("--locale", required=True, choices=("kk", "en"))
parser.add_argument("--kind", required=True, choices=("product", "post"))
parser.add_argument("--limit", type=int, default=50)
parser.add_argument("--workers", type=int, default=3)
parser.add_argument("--publish", action="store_true")
parser.add_argument("--model", default="gpt-4.1-mini")
args = parser.parse_args()

if not os.getenv("DATABASE_URL") or not os.getenv("OPENAI_API_KEY"):
    sys.exit("DATABASE_URL and OPENAI_API_KEY are required")
if args.limit < 1 or args.limit > 700 or args.workers < 1 or args.workers > 8:
    sys.exit("Invalid batch limits")

db = psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=15, autocommit=True)
with db.cursor(row_factory=psycopg.rows.dict_row) as cur:
    cur.execute("SELECT to_regclass('public.\"LocalizedContent\"') AS table_name")
    if cur.fetchone()["table_name"] is None:
        sys.exit("LocalizedContent migration must be deployed before translating")
    if args.kind == "product":
        cur.execute("""
          SELECT p.id,p.name,p."shortDescription" AS summary,p.description AS body,
                 COALESCE(b.name,'') AS brand,COALESCE(p."supplierSku",'') AS sku
          FROM "Product" p LEFT JOIN "Brand" b ON b.id=p."brandId"
          WHERE p."isPublished"=true AND p."enrichmentStatus"<>'MERGED'
          ORDER BY p."createdAt" DESC,p.id DESC
        """)
    else:
        cur.execute("""
          SELECT id,title AS name,category AS summary,content AS body,
                 '' AS brand,'' AS sku FROM "Post" ORDER BY "createdAt" DESC
        """)
    records = cur.fetchall()
    cur.execute('SELECT key,locale,"sourceHash",status FROM "LocalizedContent" WHERE locale=%s',[args.locale])
    existing = {row["key"]: row for row in cur.fetchall()}

def source_hash(item):
    data = json.dumps([item["name"],item["summary"] or "",item["body"]], ensure_ascii=False, separators=(",",":"))
    return hashlib.sha256(data.encode()).hexdigest()

queue=[]
for item in records:
    item["key"]=args.kind+":"+item["id"]
    item["hash"]=source_hash(item)
    saved=existing.get(item["key"])
    if saved and saved["sourceHash"]==item["hash"] and saved["status"]=="PUBLISHED":continue
    queue.append(item)
queue=queue[:args.limit]
print(json.dumps({"kind":args.kind,"locale":args.locale,"available":len(records),"queued":len(queue),"publish":args.publish}),flush=True)

language = "natural, native, standard Kazakh in Cyrillic used by residents of Kazakhstan" if args.locale=="kk" else "clear professional English"
PROMPT = """
You are a senior native copy editor and specialist translator of professional skincare,
dermatology, and cosmetic e-commerce content. Translate faithfully from Russian into {lang}.

Rules:
- Preserve exact brand/product line names, SKU/model codes, INCI chemical names, scientific names,
  SPF, ingredients, percentages, doses, measurements, volumes, numbers and links.
- Do NOT invent benefits, medical efficacy, warnings, ingredients, dosage or directions.
- Use natural, concise, persuasive product language without generic filler.
- The 'name' must be a product title in the target language, not a mechanical transliteration.
- Preserve the format and paragraph/bullet structure of 'body'. Do not introduce markup or JSON strings inside.
- In body, KEEP these exact Russian section labels (so our app can format their localized heading):
  'Для какой кожи', 'Для каких задач', 'Преимущества', 'Почему удобно',
  'Способ применения', 'Состав и активные компоненты', 'Важно'.
  Translate ALL explanatory text under them into target language.
- If the source contains no such section, do not create a new one.
- summary should be an accurate short description (or category for blog).
- For Kazakh, use idiomatic native Kazakh and correct morphology, not Russian words in Kazakh script.
- For English, use idiomatic professional skincare terminology.
- Respond with a JSON object only: {"name":"...","summary":"...","body":"..."}.
- The JSON fields must be strings, or summary may be null if original summary is null.
""".replace("{lang}", language)

def ask_openai(item, attempt=0):
    body=json.dumps({"model":args.model,"temperature":0.1,
      "response_format":{"type":"json_object"},
      "messages":[
        {"role":"system","content":PROMPT},
        {"role":"user","content":json.dumps({"name":item["name"],"summary":item["summary"],"body":item["body"],"brand":item["brand"],"sku":item["sku"]},ensure_ascii=False)}
      ]
    },ensure_ascii=False).encode()
    request=urllib.request.Request("https://api.openai.com/v1/chat/completions",
      data=body,method="POST",
      headers={"Content-Type":"application/json","Authorization":"Bearer "+os.environ["OPENAI_API_KEY"]})
    try:
        with urllib.request.urlopen(request,timeout=100) as response:
            out=json.loads(response.read())
        return json.loads(out["choices"][0]["message"]["content"])
    except (urllib.error.HTTPError,urllib.error.URLError,TimeoutError,ValueError,KeyError) as exc:
        if attempt<3:
            time.sleep((attempt+1)*4)
            return ask_openai(item,attempt+1)
        raise RuntimeError("translation_api_failed: "+type(exc).__name__) from None

def validate(item,translated):
    if not isinstance(translated,dict):return "not_object"
    for key in ("name","body"):
        if not isinstance(translated.get(key),str) or len(translated[key].strip())<3:return "empty_"+key
    if item["summary"] and (not isinstance(translated.get("summary"),str) or not translated["summary"].strip()):return "empty_summary"
    if item["body"] and not 0.36<=len(translated["body"])/max(1,len(item["body"]))<=2.25:return "length_mismatch"
    if len(translated["name"])>240:return "name_too_long"
    if item["brand"] and item["brand"].lower() in item["name"].lower() and item["brand"].lower() not in translated["name"].lower():return "lost_brand"
    if item["sku"] and item["sku"].lower() in item["name"].lower() and item["sku"].lower() not in translated["name"].lower():return "lost_sku"
    for url in re.findall(r'https?://[^\s)]+',item["body"]):
        if url not in translated["body"]:return "lost_url"
    return None

def work(item):
    try:
        translated=ask_openai(item)
        reason=validate(item,translated)
        if reason:
            translated=ask_openai(item)
            reason=validate(item,translated)
        return item,translated,reason
    except Exception as exc:return item,None,type(exc).__name__

done=0
failed=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
    futures=[executor.submit(work,item) for item in queue]
    for future in concurrent.futures.as_completed(futures):
        item,translation,problem=future.result()
        if problem or not translation:
            failed.append([item["key"],problem or "missing"])
            continue
        status="PUBLISHED" if args.publish else "REVIEW"
        try:
            with db.cursor() as cur:
                cur.execute("""
                  INSERT INTO "LocalizedContent"
                    (id,key,locale,name,summary,body,"sourceName","sourceSummary","sourceHash",status,"reviewedAt","createdAt","updatedAt")
                  VALUES (gen_random_uuid()::text,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW(),NOW())
                  ON CONFLICT (key,locale) DO UPDATE
                    SET name=EXCLUDED.name,summary=EXCLUDED.summary,body=EXCLUDED.body,
                      "sourceName"=EXCLUDED."sourceName",
                      "sourceSummary"=EXCLUDED."sourceSummary",
                      "sourceHash"=EXCLUDED."sourceHash",
                      status=EXCLUDED.status,"reviewedAt"=EXCLUDED."reviewedAt",
                      "updatedAt"=NOW()
                  WHERE "LocalizedContent".status<>'PUBLISHED'
                     OR "LocalizedContent"."sourceHash"<>EXCLUDED."sourceHash"
                """,[
                  item["key"],args.locale,translation["name"],translation.get("summary"),
                  translation["body"],item["name"],item["summary"],item["hash"],status,
                  None # no human approval timestamp
                ])
            done+=1
            if done%10==0:print(json.dumps({"completed":done,"failed":len(failed)}),flush=True)
        except Exception as exc:failed.append([item["key"],"db_"+type(exc).__name__])
print(json.dumps({"completed":done,"failed":len(failed),"failedKeys":failed[:20]}),flush=True)
db.close()
