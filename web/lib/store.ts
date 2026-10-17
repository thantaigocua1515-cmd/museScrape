// Lớp lưu trữ trên Upstash Redis (qua Vercel Marketplace integration).
// Env tự động inject khi connect integration: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
//
// Model:
//   ph:meta            hash: key "{proto}:{ip}:{port}" -> JSON metadata
//   ph:lat:{proto|all} zset: member key, score = http_ms (lấy proxy nhanh nhất)
//   ph:checked         zset: member key, score = last_checked epoch (recheck proxy cũ nhất)
//   ph:pending         set:  "proto|ip|port|source" chưa kiểm tra
//   ph:known           set:  key đã từng thấy (khử trùng giữa các vòng)
import { Redis } from "@upstash/redis";
import { MAX_FAILS, proxyKey, Protocol } from "./config";
import type { CheckResult } from "./checker";
import type { GeoInfo } from "./geo";

const META = "ph:meta";
const LAT = (p: string) => `ph:lat:${p}`;
const CHECKED = "ph:checked";
const PENDING = "ph:pending";
const KNOWN = "ph:known";

export interface ProxyMeta {
  protocol: Protocol;
  ip: string;
  port: number;
  country: string | null;
  country_code: string | null;
  city: string | null;
  tcp_ms: number | null;
  http_ms: number | null;
  exit_ip: string | null;
  anonymity: string | null;
  source: string;
  first_seen: string;
  last_checked: string;
  fail_count: number;
  success_count: number;
}

let _redis: Redis | null = null;
function redis(): Redis {
  if (!_redis) _redis = Redis.fromEnv();
  return _redis;
}

export function kvConfigured(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export function pendingMember(p: { protocol: string; ip: string; port: number; source: string }): string {
  return `${p.protocol}|${p.ip}|${p.port}|${p.source}`;
}

export function parsePending(m: string): { protocol: Protocol; ip: string; port: number; source: string } | null {
  const [protocol, ip, port, source] = m.split("|");
  if (!protocol || !ip || !port) return null;
  return { protocol: protocol as Protocol, ip, port: parseInt(port, 10), source: source ?? "" };
}

/** Thêm proxy mới vào hàng đợi (bỏ qua những key đã biết). Trả về số lượng thêm mới. */
export async function addPending(
  items: Array<{ protocol: Protocol; ip: string; port: number; source: string }>
): Promise<number> {
  if (items.length === 0) return 0;
  const r = redis();
  const pipe = r.pipeline();
  for (const p of items) pipe.sismember(KNOWN, proxyKey(p));
  const flags = (await pipe.exec()) as number[];
  const fresh = items.filter((_, i) => !flags[i]);
  if (fresh.length === 0) return 0;
  const pipe2 = r.pipeline();
  for (const p of fresh) {
    pipe2.sadd(PENDING, pendingMember(p));
    pipe2.sadd(KNOWN, proxyKey(p));
  }
  await pipe2.exec();
  return fresh.length;
}

/** Lấy ngẫu nhiên tối đa n member trong hàng đợi (không xoá). */
export async function samplePending(n: number): Promise<string[]> {
  const members = (await redis().srandmember(PENDING, n)) as unknown as string[] | string | null;
  if (!members) return [];
  return Array.isArray(members) ? members.map(String) : [String(members)];
}

/** Xoá các member đã xử lý xong khỏi hàng đợi. */
export async function removePending(members: string[]): Promise<void> {
  if (members.length === 0) return;
  const r = redis();
  const pipe = r.pipeline();
  for (const m of members) pipe.srem(PENDING, m);
  await pipe.exec();
}

export async function saveAlive(r: CheckResult, geo: GeoInfo | null): Promise<void> {
  const key = proxyKey(r);
  const now = new Date().toISOString();
  const prevRaw = (await redis().hget(META, key)) as string | null;
  const prev = prevRaw ? (JSON.parse(prevRaw) as ProxyMeta) : null;
  const meta: ProxyMeta = {
    protocol: r.protocol,
    ip: r.ip,
    port: r.port,
    country: geo?.country ?? prev?.country ?? null,
    country_code: geo?.country_code ?? prev?.country_code ?? null,
    city: geo?.city ?? prev?.city ?? null,
    tcp_ms: r.tcpMs ?? null,
    http_ms: r.httpMs ?? null,
    exit_ip: r.exitIp ?? null,
    anonymity: r.anonymity ?? null,
    source: r.source,
    first_seen: prev?.first_seen ?? now,
    last_checked: now,
    fail_count: 0,
    success_count: (prev?.success_count ?? 0) + 1,
  };
  const score = r.httpMs ?? 999999;
  const ts = Date.now();
  const pipe = redis().pipeline();
  pipe.hset(META, { [key]: JSON.stringify(meta) });
  pipe.zadd(LAT(r.protocol), { score, member: key });
  pipe.zadd(LAT("all"), { score, member: key });
  pipe.zadd(CHECKED, { score: ts, member: key });
  await pipe.exec();
}

/** Đánh dấu proxy chết 1 lần. Trả về fail_count mới; nếu >= MAX_FAILS thì xoá hẳn. */
export async function recordFail(key: string): Promise<{ fails: number; pruned: boolean }> {
  const r = redis();
  const raw = await r.hget<string>(META, key);
  if (!raw) return { fails: 0, pruned: false };
  const meta = JSON.parse(raw) as ProxyMeta;
  meta.fail_count += 1;
  meta.last_checked = new Date().toISOString();
  if (meta.fail_count >= MAX_FAILS) {
    const pipe = r.pipeline();
    pipe.hdel(META, key);
    pipe.zrem(LAT(meta.protocol), key);
    pipe.zrem(LAT("all"), key);
    pipe.zrem(CHECKED, key);
    pipe.srem(KNOWN, key); // cho phép phát hiện lại sau này nếu proxy sống lại
    await pipe.exec();
    return { fails: meta.fail_count, pruned: true };
  }
  const pipe = r.pipeline();
  pipe.hset(META, { [key]: JSON.stringify(meta) });
  pipe.zadd(CHECKED, { score: Date.now(), member: key });
  await pipe.exec();
  return { fails: meta.fail_count, pruned: false };
}

/** Lấy key của n proxy lâu chưa được kiểm tra nhất. */
export async function oldestChecked(n: number): Promise<string[]> {
  const members = await redis().zrange<string[]>(CHECKED, 0, n - 1);
  return members ?? [];
}

export function parseKey(key: string): { protocol: Protocol; ip: string; port: number } | null {
  const [protocol, ip, port] = key.split(":");
  if (!protocol || !ip || !port) return null;
  return { protocol: protocol as Protocol, ip, port: parseInt(port, 10) };
}

export interface ProxyOut {
  ip: string;
  port: number;
  protocol: Protocol;
  country: string | null;
  country_code: string | null;
  city: string | null;
  tcp_ms: number | null;
  http_ms: number | null;
  anonymity: string | null;
  last_checked: string;
}

/** Lấy proxy đang sống, sắp xếp theo latency tăng dần. */
export async function getProxies(
  protocol: Protocol | null,
  countryCode: string | null,
  limit: number
): Promise<ProxyOut[]> {
  const r = redis();
  const zkey = LAT(protocol ?? "all");
  const members = (await r.zrange<string[]>(zkey, 0, Math.min(limit * 3, 1500) - 1)) ?? [];
  if (members.length === 0) return [];
  const pipe = r.pipeline();
  for (const m of members) pipe.hget(META, m);
  const raws = (await pipe.exec()) as Array<string | null>;
  const out: ProxyOut[] = [];
  const wantCC = countryCode?.toUpperCase() ?? null;
  for (const raw of raws) {
    if (!raw) continue;
    const m = JSON.parse(raw) as ProxyMeta;
    if (m.fail_count !== 0) continue;
    if (wantCC && m.country_code !== wantCC) continue;
    out.push({
      ip: m.ip,
      port: m.port,
      protocol: m.protocol,
      country: m.country,
      country_code: m.country_code,
      city: m.city,
      tcp_ms: m.tcp_ms,
      http_ms: m.http_ms,
      anonymity: m.anonymity,
      last_checked: m.last_checked,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export async function getStats(): Promise<{
  total: number;
  by_protocol: Record<string, number>;
  by_country: Record<string, number>;
  avg_http_ms: number | null;
  pending: number;
}> {
  const r = redis();
  const [total, http, s4, s5, pending] = await Promise.all([
    r.zcard(LAT("all")),
    r.zcard(LAT("http")),
    r.zcard(LAT("socks4")),
    r.zcard(LAT("socks5")),
    r.scard(PENDING),
  ]);
  const all = (await r.hgetall<Record<string, string>>(META)) ?? {};
  const byCountry: Record<string, number> = {};
  let sum = 0;
  let cnt = 0;
  for (const raw of Object.values(all)) {
    try {
      const m = JSON.parse(raw) as ProxyMeta;
      if (m.fail_count !== 0) continue;
      if (m.country_code) byCountry[m.country_code] = (byCountry[m.country_code] ?? 0) + 1;
      if (m.http_ms != null) {
        sum += m.http_ms;
        cnt++;
      }
    } catch {
      /* bỏ qua */
    }
  }
  const top = Object.entries(byCountry)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  return {
    total: total ?? 0,
    by_protocol: { http: http ?? 0, socks4: s4 ?? 0, socks5: s5 ?? 0 },
    by_country: Object.fromEntries(top),
    avg_http_ms: cnt ? Math.round((sum / cnt) * 10) / 10 : null,
    pending: pending ?? 0,
  };
}
