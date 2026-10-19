import type { CatalogHubSnapshotItem } from "./catalogHubClient";

type Local={shortDescription:string|null;description:string;image:string;category:string;
  price:number;sourcePrice:number|null};

export function planCatalogHubPull(hub:CatalogHubSnapshotItem,local:Local,updatePrices=false){
  const changes:Record<string,string|number>={};
  if(!local.shortDescription?.trim()&&hub.shortDescription?.trim())changes.shortDescription=hub.shortDescription.trim();
  if((!local.description?.trim()||local.description.trim()==="Описание готовится")&&hub.description?.trim()){
    changes.description=[hub.description,hub.application&&`Применение\n${hub.application}`,
      hub.ingredients&&`Состав\n${hub.ingredients}`].filter(Boolean).join("\n\n");
  }
  if((!local.image||local.image.startsWith("/seed/"))&&hub.images?.[0])changes.image=hub.images[0];
  if((!local.category||local.category==="Без категории")&&hub.categoryKey?.trim())changes.category=hub.categoryKey.trim();
  if(updatePrices){
    if(hub.price&&hub.price>0&&hub.price!==local.price)changes.price=hub.price;
    if(hub.purchasePrice!==null&&hub.purchasePrice>=0&&hub.purchasePrice!==local.sourcePrice)
      changes.sourcePrice=hub.purchasePrice;
  }
  return changes;
}
