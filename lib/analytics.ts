// lib/analytics.ts
export type UmamiEventProps = Record<string, string | number | boolean | null | undefined>;

type Umami = {
  track: (event: string, props?: UmamiEventProps) => void;
};

declare global {
  interface Window {
    umami?: Umami;
  }
}

export function track(event: string, props?: UmamiEventProps) {
  if (typeof window === "undefined") return;
  window.umami?.track(event, props);
}
