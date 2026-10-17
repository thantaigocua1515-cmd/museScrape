// Tải + parse danh sách proxy từ các nguồn công khai, khử trùng lặp.
import { SOURCES, USER_AGENT, ProxyTarget, proxyKey } from "./config";

// Chấp nhận: "1.2.3.4:8080", "http://1.2.3.4:8080", "socks5://1.2.3.4:1080"
const LINE_RE = /^(?:(?:https?|socks[45]):\/\/)?(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/;

export function parseLines(text: string, protocol: ProxyTarget["protocol"], source: string): ProxyTarget[] {
  const out: ProxyTarget[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^[, "']+|[, "']+$/g, "");
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const ip = m[1];
    const port = parseInt(m[2], 10);
    if (!(port >= 1 && port <= 65535)) continue;
    const octs = ip.split(".").map(Number);
    if (octs.some((o) => Number.isNaN(o) || o > 255)) continue;
    if (ip === "0.0.0.0" || ip.startsWith("127.") || ip.startsWith("0.")) continue;
    out.push({ protocol, ip, port, source });
  }
  return out;
}

async function fetchOne(name: string, url: string, protocol: ProxyTarget["protocol"]): Promise<ProxyTarget[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const text = await res.text();
    return parseLines(text, protocol, name);
  } catch {
    return [];
  }
}

export async function fetchAll(): Promise<ProxyTarget[]> {
  const batches = await Promise.all(SOURCES.map((s) => fetchOne(s.name, s.url, s.protocol)));
  const seen = new Set<string>();
  const uniq: ProxyTarget[] = [];
  for (const batch of batches) {
    for (const p of batch) {
      const k = proxyKey(p);
      if (!seen.has(k)) {
        seen.add(k);
        uniq.push(p);
      }
    }
  }
  return uniq;
}
