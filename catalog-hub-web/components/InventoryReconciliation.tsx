"use client";
import Link from "next/link";
import { useState } from "react";
import { coreMessage, coreRequest } from "@/lib/core-client";

type Item = {
  productId:string; warehouseId:string; sku:string; warehouseName:string;
  reserved:number; expectedReserved:number; difference:number;
  status:"MATCH"|"MISSING_BALANCE"|"RESERVATION_SHORTFALL"|"UNASSIGNED_RESERVED";
};
type Report = { items:Item[]; checked:number; mismatches:number; nextCursor:string|null; checkedAt:string };
const labels = {
  MATCH:"Совпадает", MISSING_BALANCE:"Нет складской записи",
  RESERVATION_SHORTFALL:"Резерва не хватает", UNASSIGNED_RESERVED:"Резерв без связи с заказами",
};

export function InventoryReconciliation() {
  const [report,setReport] = useState<Report|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  async function inspect(cursor?:string) {
    setBusy(true);setError("");
    try {
      setReport(await coreRequest<Report>("inventory/reconciliation?limit=50"+
        (cursor?"&cursor="+encodeURIComponent(cursor):"")));
    } catch(cause) { setError(coreMessage(cause)); }
    finally { setBusy(false); }
  }
  return <section className="panel core-section" aria-busy={busy}>
    <h2>Сверка резервов с заказами</h2>
    <p className="subtle">Сравнивает складской резерв с активными заказами по товарам и складам.
      Резерв без связи с заказами требует проверки по документам, включая записи прежней системы.</p>
    <div className="actions">
      <button type="button" className="button" disabled={busy} onClick={()=>void inspect()}>
        {busy?"Сверяем…":"Сверить резервы"}
      </button>
      {report?.nextCursor&&<button type="button" className="button" disabled={busy}
        onClick={()=>void inspect(report.nextCursor!)}>Следующие позиции</button>}
    </div>
    {error&&<p className="error" role="alert">{error}</p>}
    {report&&<>
      <p role="status">Проверено в этой порции {report.checked}. Расхождений {report.mismatches}.
        {" "}Время проверки {new Date(report.checkedAt).toLocaleString("ru-RU")}.</p>
      {report.nextCursor&&<p className="subtle">Есть следующие позиции. Каждая порция сверяется на момент запроса.</p>}
      {!!report.items.length&&<div className="table-wrap"><table>
        <thead><tr><th>SKU / склад</th><th>В резерве</th><th>По заказам</th><th>Разница</th><th>Результат</th></tr></thead>
        <tbody>{report.items.map(item=><tr key={item.productId+":"+item.warehouseId}>
          <td><Link href={"/catalog/"+encodeURIComponent(item.productId)}>{item.sku}</Link><div className="subtle">{item.warehouseName}</div></td>
          <td>{item.reserved}</td><td>{item.expectedReserved}</td><td>{item.difference}</td><td>{labels[item.status]}</td>
        </tr>)}</tbody>
      </table></div>}
    </>}
  </section>;
}
