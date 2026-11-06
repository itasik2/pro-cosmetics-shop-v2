/** A member SKU owns its identifiers, prices, media and inventory. Common copy
 * always comes from the selected master, including explicit null/empty values.
 */
export function resolveSharedProduct<T extends {masterProduct?:unknown}>(product:T):T {
  const master=product.masterProduct;
  if(!master||typeof master!=="object")return product;
  const resolved={...product};
  for(const field of ["title","brand","shortDescription","description","application","ingredients","categoryKey"]){
    if(Object.hasOwn(master,field))(resolved as Record<string,unknown>)[field]=(master as Record<string,unknown>)[field];
  }
  return resolved;
}
