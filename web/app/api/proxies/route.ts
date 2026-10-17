// API public cho các dự án khác dùng:
//   GET /api/proxies?protocol=http&country=VN&limit=20
//   GET /api/proxies?protocol=socks5&limit=10
// Nếu đặt API_KEY trong env thì request cần ?key=... hoặc header x-api-key.
import { NextRequest, NextResponse } from "next/server";
import { getProxies, kvConfigured } from "@/lib/store";
import { corsHeaders, verifyApiKey } from "@/lib/auth";
import type { Protocol } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_PROTOCOLS: Protocol[] = ["http", "socks4", "socks5"];

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(req: NextRequest) {
  const headers = corsHeaders();
  if (!verifyApiKey(req)) {
    return NextResponse.json({ error: "unauthorized (thiếu hoặc sai API key)" }, { status: 401, headers });
  }
  if (!kvConfigured()) {
    return NextResponse.json({ error: "KV chưa được cấu hình" }, { status: 503, headers });
  }
  try {
    const url = new URL(req.url);
    const protoRaw = url.searchParams.get("protocol");
    const protocol: Protocol | null =
      protoRaw && (VALID_PROTOCOLS as string[]).includes(protoRaw) ? (protoRaw as Protocol) : null;
    const country = url.searchParams.get("country");
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 1), 500);

    const proxies = await getProxies(protocol, country, limit);
    return NextResponse.json({ count: proxies.length, proxies }, { headers });
  } catch (e) {
    console.error("[api/proxies]", e);
    return NextResponse.json({ error: "internal error" }, { status: 500, headers });
  }
}
