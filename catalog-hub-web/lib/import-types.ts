export type Field = "sku"|"barcode"|"title"|"brand"|"volume"|"purchasePrice"|"price"|"description"|"categoryKey"|"stock";
export const FIELD_LABELS: Record<Field,string> = {
 sku:"Артикул / SKU",barcode:"Штрихкод",title:"Наименование",brand:"Бренд",
 purchasePrice:"Закупочная цена, ₸",price:"Розничная цена, ₸",
 description:"Описание",categoryKey:"Категория",stock:"Остаток (только для просмотра)",
 volume:"Объём / вес упаковки",
};
export type Mapping = Partial<Record<Field,string>>;
