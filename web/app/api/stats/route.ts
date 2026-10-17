// Thống kê tổng quan kho proxy.
import { NextRequest, NextResponse } from "next/server";
import { getStats, kvConfigured } from "@/lib/store";
import { corsHeaders } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(_req: NextRequest) {
  const headers = corsHeaders();
  if (!kvConfigured()) {
    return NextResponse.json({ error: "KV chưa được cấu hình" }, { status: 503, headers });
  }
  try {
    return NextResponse.json(await getStats(), { headers });
  } catch (e) {
    console.error("[api/stats]", e);
    return NextResponse.json({ error: "internal error" }, { status: 500, headers });
  }
}
