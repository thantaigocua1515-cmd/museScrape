#!/usr/bin/env python3
"""JSON API + dashboard đơn giản để lấy proxy ra dùng.

Dùng: python api.py [--port 8080] [--host 0.0.0.0]

Endpoints:
  GET /api/proxies?protocol=http&country=VN&limit=50
  GET /api/stats
  GET /                       -> dashboard HTML
"""
import argparse
import html
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, __file__.rsplit("/", 1)[0])

from proxy_harvester import db  # noqa: E402


class Handler(BaseHTTPRequestHandler):
    server_version = "ProxyHarvester/1.0"

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _html(self, body: str, code=200):
        data = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        con = db.connect()
        try:
            if u.path == "/api/proxies":
                proxies = db.get_proxies(
                    con,
                    protocol=qs.get("protocol", [None])[0],
                    country_code=qs.get("country", [None])[0],
                    limit=int(qs.get("limit", ["50"])[0]),
                )
                self._json({"count": len(proxies), "proxies": proxies})
            elif u.path == "/api/stats":
                self._json(db.stats(con))
            elif u.path in ("/", "/index.html"):
                self._html(dashboard(db.stats(con)))
            else:
                self._json({"error": "not found"}, 404)
        except Exception as e:
            self._json({"error": str(e)}, 500)
        finally:
            con.close()

    def log_message(self, *args):
        pass


def dashboard(s: dict) -> str:
    protos = " ".join(
        f"<span class='pill'>{html.escape(k)}: <b>{v}</b></span>"
        for k, v in s["by_protocol"].items()
    ) or "<i>chưa có dữ liệu</i>"
    countries = " ".join(
        f"<span class='pill'>{html.escape(k)}: <b>{v}</b></span>"
        for k, v in s["by_country"].items()
    ) or "<i>chưa có dữ liệu</i>"
    last = s["last_run"]
    last_txt = f"{last['kind']} lúc {last['ts']}" if last else "chưa chạy"
    return f"""<!doctype html><html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Proxy Harvester</title>
<style>
body{{font-family:system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;background:#0f172a;color:#e2e8f0}}
h1{{font-size:22px}} .card{{background:#1e293b;border-radius:12px;padding:16px;margin:12px 0}}
.pill{{display:inline-block;background:#334155;border-radius:999px;padding:4px 12px;margin:3px;font-size:13px}}
b{{color:#fbbf24}} code{{background:#020617;padding:2px 8px;border-radius:6px}}
a{{color:#38bdf8}}
</style></head><body>
<h1>🌐 Proxy Harvester</h1>
<div class="card"><h3>📊 Tổng quan</h3>
<p>Proxy đang sống: <b>{s["total"]}</b> | Latency TB: <b>{s["avg_http_ms"] or "?"} ms</b><br>
Vòng chạy cuối: {html.escape(str(last_txt))}</p></div>
<div class="card"><h3>🔌 Theo giao thức</h3><p>{protos}</p></div>
<div class="card"><h3>🗺️ Top quốc gia</h3><p>{countries}</p></div>
<div class="card"><h3>⚙️ API</h3>
<p><code>GET /api/proxies?protocol=http&amp;country=VN&amp;limit=20</code><br>
<code>GET /api/proxies?protocol=socks5&amp;limit=10</code><br>
<code>GET /api/stats</code></p>
<p><a href="/api/proxies?limit=10">Thử lấy 10 proxy →</a></p></div>
</body></html>"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8080)
    args = ap.parse_args()
    db.connect().close()  # tạo DB nếu chưa có
    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f">> API chạy tại http://{args.host}:{args.port}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
