// Kiểm tra proxy bằng raw TCP socket (không cần thư viện ngoài):
// TCP ping + HTTP qua proxy + exit IP + phân loại anonymity.
// Hỗ trợ http proxy, socks4, socks5 (no-auth).
import net from "net";
import dns from "dns/promises";
import {
  CHECK_HEADERS_HOST,
  CHECK_HEADERS_URL,
  CHECK_IP_HOST,
  CHECK_IP_URL,
  CONNECT_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  USER_AGENT,
  ProxyTarget,
} from "./config";

export interface CheckResult extends ProxyTarget {
  alive: boolean;
  reason?: string;
  tcpMs?: number;
  httpMs?: number;
  exitIp?: string;
  anonymity?: "elite" | "anonymous" | "transparent" | "unknown";
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

function connectTcp(host: string, port: number, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.connect(port, host);
    const done = (fn: () => void) => {
      clearTimeout(timer);
      s.removeAllListeners();
      fn();
    };
    const timer = setTimeout(() => {
      s.destroy();
      done(() => reject(new Error("connect timeout")));
    }, timeoutMs);
    s.once("connect", () => done(() => resolve(s)));
    s.once("error", (e) => {
      s.destroy();
      done(() => reject(e));
    });
  });
}

export async function tcpPing(
  ip: string,
  port: number,
  timeoutMs = CONNECT_TIMEOUT_MS
): Promise<{ ms: number | null; ok: boolean }> {
  const t0 = Date.now();
  try {
    const s = await connectTcp(ip, port, timeoutMs);
    s.destroy();
    return { ms: Date.now() - t0, ok: true };
  } catch {
    return { ms: null, ok: false };
  }
}

// Buffered reader: giữ bytes đọc thừa để lần read sau dùng tiếp,
// tránh mất dữ liệu khi server gửi gộp nhiều gói.
class SockReader {
  private buf = Buffer.alloc(0);
  constructor(private sock: net.Socket) {}

  async read(n: number, timeoutMs: number): Promise<Buffer> {
    const deadline = Date.now() + timeoutMs;
    while (this.buf.length < n) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("read timeout");
      const chunk = await new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("read timeout"));
        }, remaining);
        const onData = (d: Buffer) => {
          cleanup();
          resolve(d);
        };
        const onErr = (e: Error) => {
          cleanup();
          reject(e);
        };
        const onClose = () => {
          cleanup();
          reject(new Error("socket closed"));
        };
        const cleanup = () => {
          clearTimeout(timer);
          this.sock.off("data", onData);
          this.sock.off("error", onErr);
          this.sock.off("close", onClose);
        };
        this.sock.on("data", onData);
        this.sock.once("error", onErr);
        this.sock.once("close", onClose);
      });
      this.buf = Buffer.concat([this.buf, chunk]);
    }
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }
}

// SOCKS5 handshake (no-auth), trả về socket đã nối tới đích.
async function connectSocks5(
  proxyIp: string,
  proxyPort: number,
  destHost: string,
  destPort: number,
  timeoutMs: number
): Promise<net.Socket> {
  const s = await connectTcp(proxyIp, proxyPort, timeoutMs);
  const rd = new SockReader(s);
  try {
    s.write(Buffer.from([0x05, 0x01, 0x00])); // VER=5, 1 method: no-auth
    const greet = await rd.read(2, timeoutMs);
    if (greet[0] !== 0x05 || greet[1] !== 0x00) throw new Error("socks5 auth required");

    const hostBuf = Buffer.from(destHost, "utf8");
    const req = Buffer.concat([
      Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
      hostBuf,
      Buffer.from([(destPort >> 8) & 0xff, destPort & 0xff]),
    ]);
    s.write(req);
    const head = await rd.read(4, timeoutMs);
    if (head[0] !== 0x05 || head[1] !== 0x00) throw new Error(`socks5 failed rep=${head[1]}`);
    const atyp = head[3];
    const restLen = atyp === 0x01 ? 6 : atyp === 0x04 ? 18 : atyp === 0x03 ? (await rd.read(1, timeoutMs))[0] + 2 : 0;
    if (restLen > 0) await rd.read(restLen, timeoutMs);
    return s;
  } catch (e) {
    s.destroy();
    throw e;
  }
}

// SOCKS4 handshake (cần IP đích dạng số).
async function connectSocks4(
  proxyIp: string,
  proxyPort: number,
  destIp: string,
  destPort: number,
  timeoutMs: number
): Promise<net.Socket> {
  const s = await connectTcp(proxyIp, proxyPort, timeoutMs);
  const rd = new SockReader(s);
  try {
    const octs = destIp.split(".").map(Number);
    const req = Buffer.from([
      0x04, 0x01,
      (destPort >> 8) & 0xff, destPort & 0xff,
      octs[0], octs[1], octs[2], octs[3],
      0x00, // USERID rỗng
    ]);
    s.write(req);
    const rep = await rd.read(8, timeoutMs);
    if (rep[1] !== 0x5a) throw new Error(`socks4 failed code=${rep[1]}`);
    return s;
  } catch (e) {
    s.destroy();
    throw e;
  }
}

// GET HTTP/1.0 qua socket, đọc tới khi server đóng kết nối.
function httpGet(
  sock: net.Socket,
  requestLine: string,
  hostHeader: string,
  timeoutMs: number
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let raw = "";
    let settled = false;
    const timer = setTimeout(() => finish(new Error("http timeout")), timeoutMs);
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      if (err) return reject(err);
      const idx = raw.indexOf("\r\n\r\n");
      if (idx < 0) return reject(new Error("bad http response"));
      const head = raw.slice(0, idx);
      const body = raw.slice(idx + 4);
      const m = head.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/m);
      resolve({ status: m ? parseInt(m[1], 10) : 0, body });
    };
    sock.on("data", (d: Buffer) => {
      raw += d.toString("utf8");
    });
    sock.once("error", (e) => finish(e as Error));
    sock.once("close", () => finish());
    sock.once("end", () => finish());
    sock.write(
      `${requestLine} HTTP/1.0\r\nHost: ${hostHeader}\r\nUser-Agent: ${USER_AGENT}\r\nConnection: close\r\n\r\n`
    );
  });
}

async function openProxySocket(
  p: ProxyTarget,
  destHost: string,
  destPort: number,
  timeoutMs: number
): Promise<{ sock: net.Socket; requestLine: string }> {
  if (p.protocol === "socks5") {
    const sock = await connectSocks5(p.ip, p.port, destHost, destPort, timeoutMs);
    return { sock, requestLine: `GET /?format=json` };
  }
  if (p.protocol === "socks4") {
    const { address } = await dns.lookup(destHost);
    const sock = await connectSocks4(p.ip, p.port, address, destPort, timeoutMs);
    return { sock, requestLine: `GET /?format=json` };
  }
  // http proxy: absolute URI
  const sock = await connectTcp(p.ip, p.port, timeoutMs);
  return { sock, requestLine: `GET http://${destHost}/?format=json` };
}

function dead(p: ProxyTarget, reason: string): CheckResult {
  return { ...p, alive: false, reason };
}

export async function getMyIp(): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(CHECK_IP_URL, {
      headers: { "User-Agent": USER_AGENT },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = (await res.json()) as { ip?: string };
    return j.ip && IPV4_RE.test(j.ip) ? j.ip : null;
  } catch {
    return null;
  }
}

export async function checkOne(p: ProxyTarget, myIp: string | null = null): Promise<CheckResult> {
  // 1) TCP ping
  const ping = await tcpPing(p.ip, p.port);
  if (!ping.ok) return dead(p, "tcp_failed");

  // 2) Request qua proxy lấy exit IP
  const t0 = Date.now();
  let exitIp: string | null = null;
  try {
    const { sock, requestLine } = await openProxySocket(p, CHECK_IP_HOST, 80, CONNECT_TIMEOUT_MS);
    const { status, body } = await httpGet(sock, requestLine, CHECK_IP_HOST, REQUEST_TIMEOUT_MS);
    if (status !== 200) return dead(p, `http_${status}`);
    try {
      const j = JSON.parse(body) as { ip?: string };
      if (j.ip && IPV4_RE.test(j.ip)) exitIp = j.ip;
    } catch {
      /* body không phải JSON */
    }
    if (!exitIp) return dead(p, "no_exit_ip");
  } catch (e) {
    return dead(p, `error:${e instanceof Error ? e.message : "unknown"}`);
  }
  const httpMs = Date.now() - t0;

  // 3) Phân loại anonymity (best-effort)
  let anonymity: CheckResult["anonymity"] = "unknown";
  try {
    const { sock, requestLine } = await openProxySocket(p, CHECK_HEADERS_HOST, 80, CONNECT_TIMEOUT_MS);
    const headersReq =
      p.protocol === "http" ? `GET ${CHECK_HEADERS_URL}` : `GET /headers`;
    const { status, body } = await httpGet(sock, headersReq, CHECK_HEADERS_HOST, REQUEST_TIMEOUT_MS);
    if (status === 200) {
      const lower = body.toLowerCase();
      const forwarded =
        lower.includes("x-forwarded-for") ||
        lower.includes('"via"') ||
        lower.includes("forwarded") ||
        lower.includes("proxy-connection");
      if (myIp && exitIp === myIp) anonymity = "transparent";
      else if (forwarded) anonymity = "anonymous";
      else anonymity = "elite";
    }
  } catch {
    /* bỏ qua, giữ unknown */
  }

  return {
    ...p,
    alive: true,
    tcpMs: ping.ms ?? undefined,
    httpMs,
    exitIp,
    anonymity,
  };
}

// Chạy song song có giới hạn concurrency.
export async function checkBatch(
  proxies: ProxyTarget[],
  myIp: string | null,
  concurrency = 30
): Promise<CheckResult[]> {
  const results: CheckResult[] = new Array(proxies.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= proxies.length) return;
      try {
        results[i] = await checkOne(proxies[i], myIp);
      } catch (e) {
        results[i] = dead(proxies[i], `error:${e instanceof Error ? e.message : "unknown"}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, proxies.length) }, worker));
  return results;
}
