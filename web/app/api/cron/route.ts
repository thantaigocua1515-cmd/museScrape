// Vòng bảo trì định kỳ: Vercel Cron (1 lần/ngày) hoặc GitHub Actions (mỗi 30 phút)
// gọi vào đây với header Authorization: Bearer <CRON_SECRET>.
import { NextRequest, NextResponse } from "next/server";
import { runCycle } from "@/lib/cycle";
import { verifyCron } from "@/lib/auth";
import { kvConfigured } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!verifyCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!kvConfigured()) {
    return NextResponse.json(
      { error: "Upstash Redis chưa được cấu hình (thiếu UPSTASH_REDIS_REST_URL/TOKEN hoặc KV_REST_API_URL/TOKEN)" },
      { status: 503 }
    );
  }
  try {
    const summary = await runCycle();
    return NextResponse.json(summary);
  } catch (e) {
    console.error("[cron]", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unknown" },
      { status: 500 }
    );
  }
}
