# 🌐 Proxy Harvester

Hệ thống tự động thu thập proxy miễn phí từ các nguồn công khai, kiểm tra chất lượng
(ping, latency, quốc gia, độ ẩn danh), lưu vào database và **giám sát liên tục**:
proxy chết sẽ bị xoá, proxy mới được bổ sung liên tục. Kèm **JSON API** cho các dự án khác dùng.

Repo có **2 bản**:

| | `web/` (khuyên dùng) | Python CLI (root) |
|---|---|---|
| Chạy ở | Vercel (serverless) | VPS / máy cá nhân |
| Database | Upstash Redis | SQLite |
| Lịch chạy | GitHub Actions mỗi 30 phút + Vercel Cron dự phòng | systemd / cron |
| API | `GET /api/proxies?...` | `python api.py` |

## Bản Web (Vercel) — bắt đầu ở đây

Xem hướng dẫn đầy đủ trong [`web/README.md`](web/README.md). Tóm tắt:

1. Import repo vào Vercel, đặt **Root Directory** = `web`
2. Thêm **Upstash Redis** trong Vercel Dashboard → Storage → Marketplace, connect vào project
3. Thêm env `CRON_SECRET` (bắt buộc), `API_KEY` (tuỳ chọn, để bảo vệ API)
4. Deploy → cấu hình GitHub Actions (Secrets: `CRON_SECRET`, Variables: `APP_URL`)
   để chạy vòng bảo trì mỗi 30 phút
5. Kích hoạt vòng đầu: `curl -H "Authorization: Bearer <CRON_SECRET>" https://<app>/api/cron`

API dùng cho các dự án khác:

```bash
curl "https://<app>/api/proxies?protocol=http&country=VN&limit=20"
curl "https://<app>/api/proxies?protocol=socks5&limit=10"
curl "https://<app>/api/stats"
```

## Bản Python CLI (VPS)

Xem tiếp bên dưới.

---

## Chức năng

- **Tự tìm proxy**: tải danh sách từ 10 nguồn công khai (TheSpeedX, monosans, proxifly,
  clarketm...) — bao gồm `http`, `socks4`, `socks5`
- **Kiểm tra**: TCP ping tới proxy, request thật qua proxy, đo latency (ms),
  lấy exit IP, phân loại ẩn danh (`elite` / `anonymous` / `transparent`)
- **Quốc gia**: tra cứu qua ip-api.com (free, có giới hạn tốc độ + cache)
- **Database**: SQLite (`data/proxies.db`) — bảng `proxies` + `harvest_log`
- **Monitor 24/7**: mỗi vòng tải proxy mới, kiểm tra lại proxy cũ,
  proxy chết ≥ 3 lần liên tiếp thì **xoá khỏi DB**
- **API**: JSON API + dashboard web để lấy proxy ra dùng

## Cài đặt

```bash
cd proxy-harvester
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Chạy thử lần đầu

```bash
# Chạy 1 lần, chỉ kiểm tra 30 proxy mới (test nhanh)
python harvest.py --limit 30

# Chạy đầy đủ (lần đầu có thể mất 20-40 phút vì check hàng nghìn proxy)
python harvest.py
```

## Monitor 24/7

**Cách 1 — daemon (khuyên dùng, cần systemd):**

```bash
sudo cp systemd/proxy-harvester.service /etc/systemd/system/
# Sửa WorkingDirectory/ExecStart trong file service cho đúng đường dẫn máy bạn
sudo systemctl daemon-reload
sudo systemctl enable --now proxy-harvester.service
sudo journalctl -u proxy-harvester.service -f   # xem log
```

**Cách 2 — cron (chạy 1 vòng mỗi 30 phút):**

```bash
crontab -e
# thêm dòng:
*/30 * * * * /opt/proxy-harvester/.venv/bin/python /opt/proxy-harvester/monitor.py --once >> /var/log/proxy-harvester.log 2>&1
```

## API lấy proxy

```bash
python api.py --port 8080
# mở http://127.0.0.1:8080 -> dashboard
```

```bash
# Lấy 20 proxy http của Việt Nam, sắp xếp theo latency
curl "http://127.0.0.1:8080/api/proxies?protocol=http&country=VN&limit=20"

# Lấy 10 proxy socks5 nhanh nhất
curl "http://127.0.0.1:8080/api/proxies?protocol=socks5&limit=10"

# Thống kê
curl "http://127.0.0.1:8080/api/stats"
```

## Cấu trúc

```
proxy_harvester/
  config.py    cấu hình: nguồn, timeout, ngưỡng xoá...
  sources.py   tải + parse + khử trùng proxy từ các nguồn
  checker.py   kiểm tra TCP ping / HTTP / exit IP / anonymity (async)
  geo.py       tra cứu quốc gia qua ip-api.com (throttled)
  db.py        SQLite: schema, upsert, prune, truy vấn
harvest.py     chạy 1 lần: tải mới -> check -> lưu
monitor.py     vòng lặp 24/7: thêm mới + kiểm tra lại + xoá proxy chết
api.py         JSON API + dashboard
systemd/       file service mẫu
```

## Lưu ý

- Proxy miễn phí **không ổn định** và có thể bị chủ proxy ghi log traffic —
  **không dùng cho đăng nhập, ngân hàng hay dữ liệu nhạy cảm**.
- Tôn trọng giới hạn của các nguồn/API miễn phí (code đã throttle sẵn).
- Nếu máy chạy sau proxy egress (mạng công ty, một số sandbox), đặt
  `PROXY_HARVESTER_TRUST_ENV=1` để chương trình dùng `http_proxy/https_proxy`
  của hệ thống.
- Database SQLite phù hợp tới vài trăm nghìn proxy; nếu cần scale lớn hơn
  có thể chuyển sang PostgreSQL (schema tương thích).
