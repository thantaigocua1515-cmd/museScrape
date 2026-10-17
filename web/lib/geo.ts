// Tra cứu quốc gia qua ip-api.com (free 45 req/phút, không cần key).
import { GEO_URL, USER_AGENT } from "./config";

export interface GeoInfo {
  country: string | null;
  country_code: string | null;
  city: string | null;
}

let lastCall = 0;
const MIN_INTERVAL_MS = 1500; // ~40 req/phút

export async function lookupIp(ip: string): Promise<GeoInfo | null> {
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastCall);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(GEO_URL(ip), {
      headers: { "User-Agent": USER_AGENT },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = (await res.json()) as {
      status?: string;
      country?: string;
      countryCode?: string;
      city?: string;
    };
    if (j.status !== "success") return null;
    return {
      country: j.country ?? null,
      country_code: j.countryCode ?? null,
      city: j.city ?? null,
    };
  } catch {
    return null;
  }
}
