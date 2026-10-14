"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import {FIELD_LABELS,type Field,type Mapping} from "@/lib/import-types";
import type {Reviewed} from "@/lib/import-review";
import {draftPdfSkuOverrides,duplicatePdfSkuGroups,validPrefix} from "@/lib/pdf-sku-drafts";
import {ENRICHMENT_LABELS,type UniversalCatalog} from "@/lib/universal-catalog";
type Preview={
 format:string;headers:string[];mapping:Mapping;review:Reviewed[];
 counts:Record<string,number>;fingerprint:string;note:string;canApply:boolean;
 warnings?:string[];pageCount?:number|null;needsManualSku?:boolean;
 universalCatalog:UniversalCatalog;
 pdfSource?:Array<{index:number;page:string;volume:string;price1:string;price2:string}>;
};
type ItemResult={rowNumber:number;sku:string;status:string;id?:string;error?:string};
type Applied={results:ItemResult[];partial:boolean;reminder:string};
type SupplierProfile = {id:string;name:string;notes:string;mapping:Mapping;updatedAt:string};
type ImportLog = {id:string;profileId:string|null;fileName:string;format:string;
 action:"PREVIEW"|"APPLY";result:string;totalRows:number;selectedRows:number;createdAt:string};

const fields=Object.keys(FIELD_LABELS) as Field[];
const statusLabel:Record<string,string>={
 CREATE:"Новый товар",UPDATE:"Изменение",SAME:"Без изменений",
 DUPLICATE:"Дубликат файла",CONFLICT:"Конфликт",INVALID:"Ошибка",
};
export function ImportConsole(){
 const [file,setFile]=useState<File|null>(null);
 const [headers,setHeaders]=useState<string[]>([]);
 const [mapping,setMapping]=useState<Mapping>({});
 const [preview,setPreview]=useState<Preview|null>(null);
 const [selected,setSelected]=useState<number[]>([]);
 const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [applied,setApplied]=useState<Applied|null>(null);
 const [profiles,setProfiles]=useState<SupplierProfile[]>([]);
 const [history,setHistory]=useState<ImportLog[]>([]);
 const [profileId,setProfileId]=useState("");
 const [profileName,setProfileName]=useState("");
 const [profileNotes,setProfileNotes]=useState("");
 const [profileError,setProfileError]=useState("");
 const [profileMessage,setProfileMessage]=useState("");
 const [profileBusy,setProfileBusy]=useState(false);
 const [pdfSkus,setPdfSkus]=useState<Record<number,string>>({});
 const [pdfNeedsRefresh,setPdfNeedsRefresh]=useState(false);
 const [pdfSkuPrefix,setPdfSkuPrefix]=useState("JDR");
 const [pdfSkuMessage,setPdfSkuMessage]=useState("");
 const [imagePage,setImagePage]=useState(1);
 const [pageImages,setPageImages]=useState<Array<{visualIndex:number;url:string;width:number;height:number}>>([]);
 const [imagesFound,setImagesFound]=useState(0);
 const [imagesBusy,setImagesBusy]=useState(false);
 const [imagesError,setImagesError]=useState("");
 async function viewPdfImages(){
   if(!file||!preview||preview.format!=="PDF")return;
   setImagesBusy(true);setImagesError("");setPageImages([]);setImagesFound(0);
   try{
     const form=new FormData();
     form.set("file",file);form.set("page",String(imagePage));
     const response=await fetch("/api/import/pdf-images",{method:"POST",body:form,cache:"no-store"});
     const parsed=await response.json().catch(()=>null);
     if(!response.ok)throw new Error(String(parsed?.error||"pdf_images_preview_failed"));
     if(!Array.isArray(parsed?.images))throw new Error("pdf_images_invalid_response");
     setPageImages(parsed.images);setImagesFound(Number(parsed.totalFound)||0);
   }catch(e){setImagesError(e instanceof Error?e.message:"pdf_images_preview_failed");}
   finally{setImagesBusy(false);}
 }


 async function refreshLocal(){
   try{
     const response=await fetch("/api/import/local-profiles",{cache:"no-store"});
     if(!response.ok)return;
     const data=await response.json();
     if(Array.isArray(data.profiles))setProfiles(data.profiles);
     if(Array.isArray(data.history))setHistory(data.history);
   }catch{ /* Profiles remain optional when not running on Ubuntu. */ }
 }
 useEffect(()=>{void refreshLocal()},[]);

 function loadProfile(id:string){
   const profile=profiles.find(p=>p.id===id);
   setProfileId(profile?.id||"");
   setProfileName(profile?.name||"");
   setProfileNotes(profile?.notes||"");
   if(profile)setMapping(profile.mapping);
   setPreview(null);
   setSelected([]);
   setConfirmed(false);
   setProfileError("");
   setProfileMessage(profile?"Загружены настройки колонок поставщика. Проверьте файл и обновите предпросмотр.":"");
 }
 async function saveProfile(){
   if(!profileName.trim()||Object.keys(mapping).filter(key=>Boolean(mapping[key as Field])).length===0){
     setProfileError("Введите название поставщика и сначала проверьте файл с сопоставленными колонками.");
     return;
   }
   setProfileBusy(true);setProfileError("");setProfileMessage("");
   try{
     const response=await fetch("/api/import/local-profiles",{
       method:"POST",headers:{"content-type":"application/json"},
       body:JSON.stringify({id:profileId||undefined,name:profileName,notes:profileNotes,mapping}),
     });
     const data=await response.json().catch(()=>null);
     if(!response.ok)throw new Error(String(data?.error||"supplier_profile_save_failed"));
     setProfileId(data.profile.id);
     setProfileMessage("Профиль сохранён на Ubuntu. Рабочая Supabase не изменялась.");
     await refreshLocal();
   }catch(e){setProfileError(e instanceof Error?e.message:String(e));}
   finally{setProfileBusy(false);}
 }
 async function deleteProfile(){
   if(!profileId)return;
   if(!window.confirm("Удалить локальный профиль поставщика? История импорта останется."))return;
   setProfileBusy(true);setProfileError("");
   try{
     const response=await fetch("/api/import/local-profiles",{
       method:"DELETE",headers:{"content-type":"application/json"},
       body:JSON.stringify({id:profileId}),
     });
     if(!response.ok)throw new Error("supplier_profile_delete_failed");
     setProfileId("");setProfileName("");setProfileNotes("");
     setProfileMessage("Профиль удалён с Ubuntu.");
     await refreshLocal();
   }catch(e){setProfileError(e instanceof Error?e.message:String(e));}
   finally{setProfileBusy(false);}
 }


 async function invoke(action:"preview"|"apply") {
  if(!file)return;
  setBusy(true);setError("");setApplied(null);
  const data=new FormData();data.set("file",file);data.set("action",action);
  if(headers.length||Object.values(mapping).some(Boolean))data.set("mapping",JSON.stringify(mapping));
  if(profileId)data.set("profileId",profileId);
  if(file.name.toLowerCase().endsWith(".pdf"))data.set("skuOverrides",JSON.stringify(pdfSkus));
  if(action==="apply"){
    if(!preview){setBusy(false);return;}
    data.set("fingerprint",preview.fingerprint);
    data.set("selected",JSON.stringify(selected));
    data.set("confirmed",confirmed?"yes":"no");
  }
  try{
    const res=await fetch("/api/import",{method:"POST",body:data,cache:"no-store"});
    const result=await res.json().catch(()=>null);
    if(!res.ok)throw new Error(String(result?.error||"import_failed"));
    if(action==="preview"){
      setPreview(result as Preview);
      setHeaders((result as Preview).headers);
      setMapping((result as Preview).mapping);
      setSelected([]);
      setConfirmed(false);
      setPdfNeedsRefresh(false);
      await refreshLocal();
    }else{
      setApplied(result as Applied);setSelected([]);setConfirmed(false);
      // Never permit a second application from a stale preview.
      setPreview(null);
      await refreshLocal();
    }
  }catch(e){setError(e instanceof Error?e.message:"Не удалось обработать файл");}
  finally{setBusy(false);}
 }
 const valid=preview?.review.filter(r=>r.status==="CREATE"||r.status==="UPDATE")||[];
 const chosen=preview?.review.filter(r=>selected.includes(r.index))||[];
 const newChosen=chosen.filter(r=>r.status==="CREATE").length;
 function downloadUniversal(){
   if(!preview||pdfNeedsRefresh)return;
   const url=URL.createObjectURL(new Blob([JSON.stringify(preview.universalCatalog,null,2)],{type:"application/json"}));
   const link=document.createElement("a");link.href=url;link.download="catalog-hub-supplier-draft.json";
   link.click();URL.revokeObjectURL(url);
 }
 return <div className="page">
   <div className="page-head"><div><h1>Импорт каталогов поставщиков</h1>
     <p>PDF-каталоги с карточками товаров, Excel (XLSX), CSV, TSV, XML/YML и JSON. Сопоставление и проверка перед применением.</p></div></div>
   <section className="panel">
     <h2>Локальные профили поставщиков</h2>
     <p className="subtle">Сохраняйте названия поставщиков и соответствие колонок на этом компьютере.
       Профили и история находятся только в папке <code>.local-data</code> на Ubuntu.
       Цены и товары в Supabase здесь не меняются.</p>
     <div className="editor-grid">
       <label className="editor-field"><span>Загрузить профиль</span>
         <select className="input" value={profileId} onChange={e=>loadProfile(e.target.value)}>
           <option value="">Новый профиль</option>
           {profiles.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
         </select>
       </label>
       <label className="editor-field"><span>Название поставщика</span>
         <input className="input" value={profileName} maxLength={120}
           placeholder="Например: Основной поставщик"
           onChange={e=>setProfileName(e.target.value)}/>
       </label>
       <label className="editor-field wide"><span>Примечание</span>
         <input className="input" value={profileNotes} maxLength={400}
           placeholder="Условия прайса и особенности формата"
           onChange={e=>setProfileNotes(e.target.value)}/>
       </label>
     </div>
     <div className="actions" style={{marginTop:14}}>
       <button type="button" className="button" disabled={profileBusy}
         onClick={saveProfile}>{profileBusy?"Сохранение…":"Сохранить профиль с текущими колонками"}</button>
       {profileId&&<button type="button" className="button" disabled={profileBusy}
         onClick={deleteProfile}>Удалить профиль</button>}
     </div>
     {profileMessage&&<p role="status" className="subtle">{profileMessage}</p>}
     {profileError&&<div className="error" role="alert">{profileError}</div>}
   </section>
   <section className="panel" style={{marginTop:14}}>
     <h2>1. Выберите файл</h2>
     <p className="subtle">XLSX/CSV/XML/JSON — до 2 МБ и 200 строк; PDF с текстовым слоем — до 8 МБ, 30 страниц и 400 строк.
       Сканированные PDF пока требуют OCR. Оригиналы не сохраняются, складские остатки не обновляются автоматически.</p>
     <label className="editor-field"><span>Файл поставщика</span>
       <input className="input" type="file" accept=".pdf,.xlsx,.csv,.tsv,.xml,.yml,.json"
         onChange={e=>{
           setFile(e.target.files?.[0]||null);setPreview(null);setHeaders([]);
           setMapping(profileId?mapping:{});setSelected([]);setConfirmed(false);setApplied(null);setError("");
           setPdfSkus({});setPdfNeedsRefresh(false);setPdfSkuMessage("");
           setPageImages([]);setImagesFound(0);setImagesError("");setImagePage(1);
         }}/>
     </label>
     {headers.length>0&&<div style={{marginTop:15}}>
       <h3>Сопоставление колонок</h3>
       <p className="subtle">Можно вручную изменить соответствие колонок. Для поиска товара требуется SKU или штрихкод.</p>
       <div className="editor-grid">
         {fields.map(field=><label className="editor-field" key={field}>
           <span>{FIELD_LABELS[field]}</span>
           <select className="input" value={mapping[field]||""}
             onChange={e=>{setMapping(m=>({...m,[field]:e.target.value||undefined}));
               setPreview(null);setSelected([]);setConfirmed(false);}}>
             <option value="">Не импортировать</option>
             {headers.map(h=><option key={h} value={h}>{h}</option>)}
           </select>
         </label>)}
       </div>
     </div>}
     <div className="actions" style={{marginTop:14}}>
       <button type="button" className="button primary" disabled={!file||busy}
         onClick={()=>invoke("preview")}>
         {busy?"Обработка…":preview||pdfNeedsRefresh?"Обновить предпросмотр":"Проверить и показать изменения"}
       </button>
     </div>
   </section>
   {error&&<div className="error" role="alert" style={{marginTop:14}}>{error}</div>}
   {preview&&<>
     <section className="panel" style={{marginTop:14}}>
       <h2>2. Результат сопоставления</h2>
       <p className="subtle">Формат: {preview.format}.
         {preview.pageCount?" Страниц: "+preview.pageCount+".":""}
         Всего строк: {preview.review.length}.
         Обновление существующих карточек не выполняется сразу — создаётся черновик в разделе «Изменения».</p>
       {preview.format==="PDF"&&<div className="import-warning" role="status">
         PDF содержит карточки, а не таблицу: система не придумывает артикулы и не назначает цену 1 или 2 автоматически.
         Укажите внутренний SKU для новых товаров и выберите нужную колонку цены выше.
         После ручных изменений нажмите «Обновить предпросмотр».
       </div>}
       {preview.warnings?.map((w,i)=><p className="subtle" key={i}>{w}</p>)}
       <div className="actions" style={{marginTop:12}}>
         <button className="button" type="button" disabled={busy||pdfNeedsRefresh} onClick={downloadUniversal}>Скачать универсальный JSON</button>
         <Link className="button" href="/ai">Очередь ИИ-обогащения →</Link>
       </div>
       <p className="subtle">Универсальный черновик содержит закупочные цены и источники полей. Он предназначен для внутренней проверки.</p>
       {preview.format==="PDF"&&<div className="panel" style={{padding:15,marginTop:12,marginBottom:12}}>
         <h3>Фотографии товаров из PDF — просмотр</h3>
         <p className="subtle">
           Используется извлечение встроенных фотографий из ProCosmetics.
           Изображения загружаются только для выбранной страницы и показываются здесь.
           Фотографии не сохраняются и не прикрепляются к товарам автоматически.
         </p>
         <div className="actions" style={{alignItems:"end"}}>
           <label className="editor-field" style={{maxWidth:190}}>
             <span>Страница PDF</span>
             <select className="input" value={imagePage}
               onChange={e=>{
                 setImagePage(Number(e.target.value));setPageImages([]);
                 setImagesFound(0);setImagesError("");
               }}>
               {Array.from({length:Math.min(preview.pageCount||1,30)},(_,i)=>
                 <option key={i+1} value={i+1}>Страница {i+1}</option>)}
             </select>
           </label>
           <button className="button" type="button" onClick={()=>void viewPdfImages()} disabled={imagesBusy}>
             {imagesBusy?"Читаем фотографии…":"Показать фотографии страницы"}
           </button>
         </div>
         {imagesError&&<div className="error" role="alert">{imagesError}</div>}
         {imagesFound>0&&<p className="subtle">
           На странице {imagePage}: показано {pageImages.length} из {imagesFound} встроенных изображений.
           В предпросмотре товаров на странице: {preview.pdfSource?.filter(row=>row.page===String(imagePage)).length||0}.
           Количество и порядок картинок не гарантируют соответствие карточкам.
         </p>}
         {pageImages.length>0&&<div className="profile-grid" style={{marginTop:12}}>
           {pageImages.map(img=><figure className="profile-card" key={img.visualIndex}>
             {/* A PDF data URI is temporary; there is no CDN URL for next/image. */}
             {/* eslint-disable-next-line @next/next/no-img-element */}
             <img alt={"Встроенное изображение PDF № "+(img.visualIndex+1)}
               src={img.url} loading="lazy"
               style={{maxWidth:"100%",maxHeight:210,objectFit:"contain",display:"block",margin:"auto"}}/>
             <figcaption className="subtle" style={{marginTop:8}}>
               Изображение № {img.visualIndex+1} · {img.width} × {img.height}
             </figcaption>
           </figure>)}
         </div>}
       </div>}

       {preview.format==="PDF"&&<div className="panel" style={{padding:15,marginTop:12,marginBottom:12}}>
         <h3>Предложения внутренних SKU для PDF</h3>
         <p className="subtle">Это ваши ВНУТРЕННИЕ идентификаторы, не артикулы производителя.
           Они формируются из названия и объёма. Повторные карточки получают одинаковый код
           и будут отмечены как дубликаты — проверьте вручную.</p>
         <div className="actions" style={{alignItems:"end"}}>
           <label className="editor-field" style={{maxWidth:170}}>
             <span>Префикс производителя</span>
             <input className="input" maxLength={12} value={pdfSkuPrefix}
               onChange={e=>setPdfSkuPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""))}/>
           </label>
           <button className="button" type="button" disabled={busy||!validPrefix(pdfSkuPrefix)}
             onClick={()=>{
               const generated=draftPdfSkuOverrides(preview.review.map(row=>({
                 index:row.index,title:row.title,sku:row.sku,
               })),pdfSkuPrefix,pdfSkus);
               setPdfSkus(generated);setPdfNeedsRefresh(true);setSelected([]);setConfirmed(false);
               setPdfSkuMessage("Сформированы предварительные внутренние SKU. Проверьте их и обновите предпросмотр.");
             }}>
             Предложить SKU для всех пустых строк
           </button>
         </div>
         {pdfSkuMessage&&<p className="subtle" role="status">{pdfSkuMessage}</p>}
         {duplicatePdfSkuGroups(preview.review.map(row=>({
           index:row.index,title:row.title,sku:row.sku,
         })),pdfSkus).map(group=><div className="error" role="alert" key={group.sku}>
           <strong>Совпадающий внутренний SKU: {group.sku}</strong>
           <div>Проверьте, не потерян ли объём или название товара. Совпадение не устраняется автоматически.</div>
           {group.items.map(item=><div key={item.index}>
             Строка №{item.index+2} · Страница {preview.pdfSource?.[item.index]?.page||"—"}
             {" — "}{item.title}
           </div>)}
         </div>)}
         <p className="subtle">Исходные цены: «Цена 1» и «Цена 2» не назначаются автоматически.
           Выберите их значения в блоке «Сопоставление колонок» выше и снова проверьте строки.</p>
       </div>}
       {pdfNeedsRefresh&&<p className="error" role="status">SKU изменены: обновите предпросмотр перед подтверждением.</p>}
       <div className="import-summary">
         {Object.entries(statusLabel).map(([key,value])=>
           <span className="badge" key={key}>{value}: {preview.counts[key]||0}</span>)}
       </div>
       <div className="table-wrap import-table">
         <table><thead><tr><th>Выбор</th><th>Строка / SKU</th><th>Товар</th>
           <th>Сопоставление</th><th>Изменения / замечания</th><th>Остаток файла</th></tr></thead>
           <tbody>{preview.review.map(row=>{
             const allowed=row.status==="UPDATE"||row.status==="CREATE";
             return <tr key={row.index}>
               <td><input aria-label={"Выбрать строку "+row.rowNumber} type="checkbox"
                 disabled={!allowed||busy||pdfNeedsRefresh}
                 checked={selected.includes(row.index)}
                 onChange={e=>setSelected(prev=>e.target.checked?[...prev,row.index]:prev.filter(x=>x!==row.index))}/></td>
               <td><strong>№ {row.rowNumber}</strong><div className="mono subtle">{row.sku||"—"}</div>
                 {preview.format==="PDF"&&<label className="editor-field" style={{marginTop:6}}>
                   <span>Внутренний SKU</span>
                   <input className="input" type="text" maxLength={100}
                     value={pdfSkus[row.index]??row.sku}
                     placeholder="Введите свой SKU"
                     onChange={e=>{
                       setPdfSkus(prev=>({...prev,[row.index]:e.target.value}));
                       setPdfNeedsRefresh(true);setSelected([]);setConfirmed(false);
                     }}/>
                 </label>}</td>
               <td>{row.title||"—"}<div className="subtle">{row.barcode||""}</div>
                 {preview.universalCatalog.products[row.index]?.enrichment.missingFields.length>0&&<div className="subtle">
                   Не хватает в прайсе: {preview.universalCatalog.products[row.index].enrichment.missingFields.map(f=>ENRICHMENT_LABELS[f]).join(", ")}
                 </div>}
                 {row.productId&&<Link href={"/ai?sku="+encodeURIComponent(preview.universalCatalog.products[row.index].identity.internalSku||row.sku)}>Обогатить карточку →</Link>}
                 {preview.format==="PDF"&&(()=>{
                   const source=preview.pdfSource?.[row.index];
                   if(!source)return null;
                   return <div className="subtle">
                     <div>Стр. {source.page}{source.volume?" · Объём: "+source.volume:" · Объём не найден"}</div>
                     <div>Цена 1: {source.price1?Number(source.price1).toLocaleString("ru-RU")+" ₸":"—"}</div>
                     <div>Цена 2: {source.price2?Number(source.price2).toLocaleString("ru-RU")+" ₸":"—"}</div>
                   </div>;
                 })()}</td>
               <td><strong>{statusLabel[row.status]}</strong>
                 <div className="subtle">{row.matchedBy? "Совпадение: "+row.matchedBy:""}</div></td>
               <td>
                 {row.changes.map(c=><div className="import-change" key={c.field}>
                   <strong>{c.field}</strong>: {String(c.before??"—")} → {String(c.after??"—")}
                 </div>)}
                 {row.reasons.map((msg,i)=><div key={i} className="import-warning">{msg}</div>)}
               </td>
               <td>{row.sourceStock??"—"} <span className="subtle">(не меняется)</span></td>
             </tr>;
           })}</tbody></table>
       </div>
       <div className="actions" style={{marginTop:14}}>
         <button className="button" type="button" disabled={!valid.length||busy||pdfNeedsRefresh}
           onClick={()=>setSelected(valid.slice(0,20).map(r=>r.index))}>Выбрать до 20 подходящих</button>
         <button className="button" type="button" disabled={!selected.length||busy}
           onClick={()=>setSelected([])}>Снять выделение</button>
       </div>
     </section>
     <section className="panel" style={{marginTop:14}}>
       <h2>3. Подтвердить выбранные строки</h2>
       <p className="subtle">Выбрано: {selected.length}. Новых товаров: {newChosen};
         изменений: {chosen.filter(r=>r.status==="UPDATE").length}.</p>
       <p className="subtle">Новые товары создаются сразу, но с нулевым остатком.
         Изменения существующих карточек попадают в очередь на согласование.
         Максимум 20 строк за операцию. В случае ошибки уже выполненные строки не откатываются.</p>
       {!preview.canApply&&<p className="error" role="status">
         Локальный режим только чтения: сохранение отключено. Можно проверить прайс, сопоставление и профили поставщиков.
         Для операций записи необходимо сначала подключить отдельную тестовую базу.
       </p>}
       <label className="review-check">
         <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
         Подтверждаю создание новых товаров и передачу изменений на проверку
       </label>
       <div className="actions" style={{marginTop:12}}>
         <button className="button primary" type="button"
           disabled={!preview.canApply||pdfNeedsRefresh||!confirmed||!selected.length||selected.length>20||busy}
           onClick={()=>invoke("apply")}>
           {busy?"Применение…":"Подтвердить выбранные строки"}
         </button>
       </div>
     </section>
   </>}
   {history.length>0&&<section className="panel" style={{marginTop:14}}>
     <h2>Локальная история загрузок</h2>
     <p className="subtle">История хранит только имена файлов, результаты сопоставления и даты. Сами файлы не сохраняются.</p>
     <div className="list">{history.slice(0,10).map(entry=><div key={entry.id} className="list-row">
       <div><strong>{entry.fileName}</strong> · {entry.action==="PREVIEW"?"Предпросмотр":"Применение"}
         <div className="subtle">{entry.format} · {entry.totalRows} строк ·
           {new Date(entry.createdAt).toLocaleString("ru-RU")}</div>
       </div><span className="badge">{entry.result}</span>
     </div>)}</div>
   </section>}
   {applied&&<section className="panel" style={{marginTop:14}}>
     <h2>Результат применения</h2>
     <p className="subtle">{applied.reminder}</p>
     {applied.partial&&<div className="error">Выполнение прервано при ошибке. Проверьте список перед повторной попыткой.</div>}
     <div className="list">{applied.results.map(r=><div className="list-row" key={r.rowNumber}>
       <span>{r.sku} · строка {r.rowNumber} · <strong>{r.status}</strong>
         {r.error&&<span className="error">{r.error}</span>}</span>
       {r.id&&<Link className="button" href={(r.status==="STAGED"?"/changes/":"/catalog/")+encodeURIComponent(r.id)}>Открыть →</Link>}
       {r.status==="CREATED"&&<Link className="button" href={"/ai?sku="+encodeURIComponent(r.sku)}>Дополнить с помощью ИИ →</Link>}
     </div>)}</div>
     <Link href="/changes" className="button" style={{marginTop:15}}>Очередь изменений →</Link>
   </section>}
 </div>;
}
