/** Resize only unsigned, versioned Cloudinary uploads; keep the original asset and its processing chain. */
export function productThumbnail(value: string, width: number) {
  if (!Number.isInteger(width) || width < 80 || width > 1200) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || url.username || url.password || url.port ||
      !/^\/[^/]+\/image\/upload\//.test(url.pathname) || /\/s--[^/]+--\//.test(url.pathname) || url.searchParams.has("__cld_token")) return value;
    const version = /\/v\d+\//.exec(url.pathname);
    if (!version || version.index === undefined) return value;
    url.pathname = url.pathname.slice(0, version.index) + `/c_limit,h_${width},w_${width}/f_auto,q_auto` + url.pathname.slice(version.index);
    return url.toString();
  } catch { return value; }
}
