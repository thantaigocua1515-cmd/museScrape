"""Cấu hình hệ thống proxy harvester."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "proxies.db"

# Đặt PROXY_HARVESTER_TRUST_ENV=1 nếu máy chạy sau proxy egress (vd. sandbox, mạng công ty)
# để aiohttp tôn trọng biến môi trường http_proxy/https_proxy.
TRUST_ENV = os.environ.get("PROXY_HARVESTER_TRUST_ENV") == "1"

# Các nguồn proxy miễn phí công khai (đã verify còn sống 2026-10-17)
# Format mỗi dòng: "IP:port" hoặc "http://IP:port"
SOURCES = [
    ("thespeedx-http",   "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt", "http"),
    ("thespeedx-socks4", "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt", "socks4"),
    ("thespeedx-socks5", "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt", "socks5"),
    ("monosans-http",    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt", "http"),
    ("monosans-socks4",  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks4.txt", "socks4"),
    ("monosans-socks5",  "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt", "socks5"),
    ("proxifly-http",    "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt", "http"),
    ("proxifly-socks4",  "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks4/data.txt", "socks4"),
    ("proxifly-socks5",  "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.txt", "socks5"),
    ("clarketm-http",    "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt", "http"),
]

# Endpoint kiểm tra: trả về IP thật mà proxy dùng để ra ngoài
CHECK_IP_URL = "https://api.ipify.org?format=json"
# Endpoint phát hiện anonymity (xem header proxy có forward không)
CHECK_HEADERS_URL = "http://httpbin.org/headers"
# Tra cứu quốc gia (free tier 45 req/phút, không cần key)
GEO_URL = "http://ip-api.com/json/{ip}?fields=status,country,countryCode,city,query"

CONNECT_TIMEOUT = 8      # giây: timeout TCP connect (đo ping)
REQUEST_TIMEOUT = 15     # giây: timeout 1 request qua proxy
MAX_CONCURRENCY = 100    # số proxy check song song
MAX_FAILS = 3            # chết liên tiếp N lần -> xoá khỏi DB
RECHECK_BATCH = 600      # mỗi vòng monitor kiểm tra lại tối đa N proxy cũ
MONITOR_INTERVAL = 1800  # giây giữa các vòng monitor (30 phút)
GEO_PER_MINUTE = 40      # giới hạn gọi ip-api.com

USER_AGENT = "proxy-harvester/1.0 (+github.com/thantaigocua1515-cmd/museScrape)"
