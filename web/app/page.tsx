// Dashboard: tổng quan kho proxy + tài liệu API.
import { getStats, getProxies, kvConfigured } from "@/lib/store";

export const dynamic = "force-dynamic";

const card: React.CSSProperties = {
  background: "#1e293b",
  borderRadius: 12,
  padding: 16,
  margin: "12px 0",
};
const pill: React.CSSProperties = {
  display: "inline-block",
  background: "#334155",
  borderRadius: 999,
  padding: "4px 12px",
  margin: 3,
  fontSize: 13,
};

function SetupHelp() {
  return (
    <div style={{ maxWidth: 900, margin: "24px auto", padding: "0 16px" }}>
      <h1>🌐 Proxy Harvester</h1>
      <div style={card}>
        <h3>⚠️ Chưa cấu hình Upstash Redis</h3>
        <ol>
          <li>Vercel Dashboard → project → <b>Storage</b> → <b>Marketplace</b> → tìm <b>Upstash Redis</b> → Add integration</li>
          <li>Connect vào project này (env <code>UPSTASH_REDIS_REST_URL</code>/<code>TOKEN</code> hoặc <code>KV_REST_API_URL</code>/<code>TOKEN</code> tự thêm)</li>
          <li>Thêm env <code>CRON_SECRET</code> (chuỗi ngẫu nhiên) trong <b>Settings → Environment Variables</b></li>
          <li>Redeploy, rồi gọi <code>GET /api/cron</code> với header <code>Authorization: Bearer &lt;CRON_SECRET&gt;</code> để chạy vòng đầu</li>
        </ol>
        <p>Chi tiết đầy đủ trong <code>web/README.md</code>.</p>
      </div>
    </div>
  );
}

export default async function Home() {
  if (!kvConfigured()) return <SetupHelp />;
  let stats;
  try {
    stats = await getStats();
  } catch {
    return <SetupHelp />;
  }
  const sample = await getProxies(null, null, 10).catch(() => []);

  return (
    <div style={{ maxWidth: 900, margin: "24px auto", padding: "0 16px" }}>
      <h1>🌐 Proxy Harvester</h1>

      <div style={card}>
        <h3>📊 Tổng quan</h3>
        <p>
          Proxy đang sống: <b style={{ color: "#fbbf24" }}>{stats.total}</b>
          {" | "}Latency TB: <b style={{ color: "#fbbf24" }}>{stats.avg_http_ms ?? "?"} ms</b>
          {" | "}Chờ kiểm tra: <b style={{ color: "#fbbf24" }}>{stats.pending}</b>
        </p>
        <p>
          {Object.entries(stats.by_protocol).map(([k, v]) => (
            <span key={k} style={pill}>{k}: <b>{v}</b></span>
          ))}
        </p>
        <p>
          {Object.entries(stats.by_country).map(([k, v]) => (
            <span key={k} style={pill}>{k}: <b>{v}</b></span>
          ))}
        </p>
      </div>

      <div style={card}>
        <h3>⚡ 10 proxy nhanh nhất</h3>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#94a3b8" }}>
              <th>Proxy</th><th>Quốc gia</th><th>Ping</th><th>Latency</th><th>Ẩn danh</th>
            </tr>
          </thead>
          <tbody>
            {sample.map((p) => (
              <tr key={`${p.protocol}:${p.ip}:${p.port}`} style={{ borderTop: "1px solid #334155" }}>
                <td><code>{p.protocol}://{p.ip}:{p.port}</code></td>
                <td>{p.country_code ?? "?"}</td>
                <td>{p.tcp_ms ?? "?"} ms</td>
                <td>{p.http_ms ?? "?"} ms</td>
                <td>{p.anonymity ?? "?"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={card}>
        <h3>⚙️ API cho các dự án khác</h3>
        <p><code>GET /api/proxies?protocol=http&amp;country=VN&amp;limit=20</code></p>
        <p><code>GET /api/proxies?protocol=socks5&amp;limit=10</code></p>
        <p><code>GET /api/stats</code></p>
        <p style={{ color: "#94a3b8", fontSize: 13 }}>
          Nếu đã đặt <code>API_KEY</code>: thêm <code>?key=...</code> hoặc header <code>x-api-key</code>.
        </p>
      </div>
    </div>
  );
}
