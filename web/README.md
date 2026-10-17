# 🌐 Proxy Harvester — bản Web (Vercel)

Tự động thu thập proxy miễn phí từ các nguồn công khai, kiểm tra chất lượng
(ping, latency, quốc gia, độ ẩn danh), lưu vào **Upstash Redis** và giám sát liên tục:
proxy chết bị xoá, proxy mới được bổ sung. Kèm **JSON API** để các dự án khác dùng.

## Kiến trúc

```
Nguồn proxy public (10 list) ─┐
                              ▼
/api/cron ──► fetch ──► check batch ──► Upstash Redis ──► /api/proxies ──► dự án khác
   ▲                         (ping/latency/exit IP/geo/anonymity)
   │         ┌── Vercel Cron (dự phòng, 1 lần/ngày — giới hạn gói Hobby)
   └─────────┴── GitHub Actions (chính, mỗi 30 phút)
```

- Mỗi vòng cron: tải list mới → check tối đa 150 proxy mới + kiểm tra lại 150 proxy
  cũ nhất → tra cứu quốc gia (tối đa 30) → xoá proxy chết ≥ 3 lần liên tiếp.
- Vòng chạy trong 1 serverless function (`maxDuration: 300`), tự dừng khi gần hết giờ;
  proxy chưa xử lý xong vẫn nằm trong hàng đợi cho vòng sau.

## Deploy lên Vercel

**1. Import repo vào Vercel**, ở bước cấu hình project đặt:

- **Root Directory**: `web`

**2. Thêm Upstash Redis**: Vercel Dashboard → project → **Storage** →
**Marketplace** → tìm **Upstash Redis** → Add integration → connect vào project
(env `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` tự được thêm).

**3. Environment Variables** (Settings → Environment Variables):

| Biến | Bắt buộc | Mô tả |
|---|---|---|
| `CRON_SECRET` | ✅ | Chuỗi ngẫu nhiên, dùng để gọi `/api/cron` |
| `API_KEY` | không | Nếu đặt, `/api/proxies` yêu cầu `?key=` hoặc header `x-api-key` |

**4. Deploy.** Vercel Cron trong `vercel.json` chạy `/api/cron` 1 lần/ngày (02:00 UTC)
làm dự phòng. Muốn chạy **mỗi 30 phút** (khuyên dùng):

- Vào repo GitHub → **Settings → Secrets and variables → Actions**:
  - **Secrets** → New repository secret: `CRON_SECRET` (giống hệt trên Vercel)
  - **Variables** → New repository variable: `APP_URL` (vd. `https://musescrape.vercel.app`)
- File `.github/workflows/proxy-cron.yml` có sẵn ở root repo sẽ tự chạy.

**5. Kích hoạt vòng đầu**: sau khi deploy,
```bash
curl -H "Authorization: Bearer <CRON_SECRET>" https://<app>/api/cron
```

## API cho các dự án khác

```bash
# 20 proxy http của VN, sắp xếp theo latency
curl "https://<app>/api/proxies?protocol=http&country=VN&limit=20"

# 10 proxy socks5 nhanh nhất
curl "https://<app>/api/proxies?protocol=socks5&limit=10"

# Thống kê
curl "https://<app>/api/stats"
```

Response `/api/proxies`:
```json
{
  "count": 20,
  "proxies": [
    {
      "ip": "1.2.3.4", "port": 8080, "protocol": "http",
      "country": "Vietnam", "country_code": "VN", "city": "Hanoi",
      "tcp_ms": 45.2, "http_ms": 210.5, "anonymity": "elite",
      "last_checked": "2026-10-17T09:00:00+00:00"
    }
  ]
}
```

Nếu đã đặt `API_KEY`: `curl "https://<app>/api/proxies?limit=10&key=<API_KEY>"`
hoặc header `x-api-key: <API_KEY>`. CORS đã mở `*` nên gọi trực tiếp từ browser được.

## Chạy local

```bash
cd web
npm install
vercel link          # liên kết project
vercel env pull      # kéo env (gồm UPSTASH_*) về .env.local
npm run dev
```

## Lưu ý

- Proxy miễn phí **không ổn định**, chất lượng thay đổi theo giờ —
  luôn lấy từ API lúc dùng, đừng cache cứng.
- **Không dùng cho đăng nhập, ngân hàng hay dữ liệu nhạy cảm** (chủ proxy có thể log traffic).
- Gói Hobby: cron của Vercel tối đa 1 lần/ngày — đã có GitHub Actions bù vào.
  Muốn cron ngay trên Vercel mỗi phút thì cần gói Pro.
