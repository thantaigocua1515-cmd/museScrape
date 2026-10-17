// Xác thực cho các endpoint nội bộ.
import { NextRequest } from "next/server";

export function verifyCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[auth] CRON_SECRET chưa được cấu hình — endpoint /api/cron đang mở!");
    return true;
  }
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export function verifyApiKey(req: NextRequest): boolean {
  const key = process.env.API_KEY;
  if (!key) return true; // chưa đặt API_KEY -> API mở
  const url = new URL(req.url);
  const q = url.searchParams.get("key");
  const h = req.headers.get("x-api-key");
  return q === key || h === key;
}

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
  };
}
