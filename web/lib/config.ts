// Cấu hình hệ thống proxy harvester (bản web/Vercel)

export type Protocol = "http" | "socks4" | "socks5";

export interface ProxyTarget {
  protocol: Protocol;
  ip: string;
  port: number;
  source: string;
}

// Các nguồn proxy miễn phí công khai (đã verify còn sống 2026-10-17)
export const SOURCES: Array<{ name: string; url: string; protocol: Protocol }> = [
  { name: "thespeedx-http", url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt", protocol: "http" },
  { name: "thespeedx-socks4", url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt", protocol: "socks4" },
  { name: "thespeedx-socks5", url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt", protocol: "socks5" },
  { name: "monosans-http", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt", protocol: "http" },
  { name: "monosans-socks4", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks4.txt", protocol: "socks4" },
  { name: "monosans-socks5", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt", protocol: "socks5" },
  { name: "proxifly-http", url: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt", protocol: "http" },
  { name: "proxifly-socks4", url: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks4/data.txt", protocol: "socks4" },
  { name: "proxifly-socks5", url: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.txt", protocol: "socks5" },
  { name: "clarketm-http", url: "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt", protocol: "http" },
];

// Dùng http (không phải https) để check qua raw socket cho đơn giản,
// không cần TLS handshake qua proxy. Chỉ đọc chuỗi IP nên an toàn.
export const CHECK_IP_URL = "http://api.ipify.org/?format=json";
export const CHECK_IP_HOST = "api.ipify.org";
export const CHECK_HEADERS_URL = "http://httpbin.org/headers";
export const CHECK_HEADERS_HOST = "httpbin.org";

// Tra cứu quốc gia (free 45 req/phút, không cần key)
export const GEO_URL = (ip: string) =>
  `http://ip-api.com/json/${ip}?fields=status,country,countryCode,city,query`;

export const CONNECT_TIMEOUT_MS = 8000; // timeout TCP connect (đo ping)
export const REQUEST_TIMEOUT_MS = 15000; // timeout 1 request qua proxy
export const CHECK_CONCURRENCY = 30; // số proxy check song song trong 1 function
export const MAX_FAILS = 3; // chết liên tiếp N lần -> xoá khỏi KV

// Budget cho 1 vòng cron (giữ dưới maxDuration 300s)
export const CYCLE_CHECK_NEW = 150; // số proxy mới check mỗi vòng
export const CYCLE_RECHECK = 150; // số proxy cũ kiểm tra lại mỗi vòng
export const CYCLE_GEO = 30; // số proxy tra cứu quốc gia mỗi vòng
export const CYCLE_TIME_BUDGET_MS = 260_000; // dừng trước khi hết giờ

export const USER_AGENT = "proxy-harvester-web/1.0";

export const proxyKey = (p: { protocol: string; ip: string; port: number }) =>
  `${p.protocol}:${p.ip}:${p.port}`;
