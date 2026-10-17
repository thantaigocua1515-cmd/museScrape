// Một vòng bảo trì: tải proxy mới -> check -> kiểm tra lại proxy cũ ->
// điền quốc gia -> xoá proxy chết. Thiết kế để chạy trong 1 Vercel function
// (tự dừng khi gần hết time budget).
import { fetchAll } from "./sources";
import { checkBatch, getMyIp, CheckResult } from "./checker";
import { lookupIp } from "./geo";
import {
  addPending,
  getStats,
  oldestChecked,
  parseKey,
  parsePending,
  recordFail,
  removePending,
  samplePending,
  saveAlive,
} from "./store";
import {
  CHECK_CONCURRENCY,
  CYCLE_CHECK_NEW,
  CYCLE_GEO,
  CYCLE_RECHECK,
  CYCLE_TIME_BUDGET_MS,
  proxyKey,
  ProxyTarget,
} from "./config";

export interface CycleSummary {
  ok: boolean;
  fetched: number;
  new_queued: number;
  new_checked: number;
  new_alive: number;
  rechecked: number;
  still_alive: number;
  pruned: number;
  geo_filled: number;
  total_alive: number;
  ms: number;
  note?: string;
}

export async function runCycle(): Promise<CycleSummary> {
  const t0 = Date.now();
  const timeLeft = () => CYCLE_TIME_BUDGET_MS - (Date.now() - t0);
  const summary: CycleSummary = {
    ok: true,
    fetched: 0,
    new_queued: 0,
    new_checked: 0,
    new_alive: 0,
    rechecked: 0,
    still_alive: 0,
    pruned: 0,
    geo_filled: 0,
    total_alive: 0,
    ms: 0,
  };

  // 1) Tải proxy mới từ các nguồn
  const all = await fetchAll();
  summary.fetched = all.length;
  summary.new_queued = await addPending(all);

  const myIp = await getMyIp();

  // 2) Check proxy mới (lấy mẫu, không pop để tránh mất hàng khi hết giờ)
  if (timeLeft() > 60_000) {
    const members = await samplePending(CYCLE_CHECK_NEW);
    const targets: Array<ProxyTarget & { _m: string }> = [];
    for (const m of members) {
      const p = parsePending(m);
      if (p) targets.push({ ...p, _m: m });
    }
    summary.new_checked = targets.length;
    if (targets.length > 0) {
      const results = await checkBatch(
        targets.map(({ _m, ...p }) => p),
        myIp,
        CHECK_CONCURRENCY
      );
      let geoDone = 0;
      for (let i = 0; i < results.length; i++) {
        if (timeLeft() < 25_000) {
          summary.note = "hết time budget, dừng sớm (proxy chưa xử lý vẫn còn trong hàng đợi)";
          break;
        }
        const r = results[i];
        await removePending([targets[i]._m]);
        if (!r.alive) continue;
        let geo = null;
        if (geoDone < CYCLE_GEO) {
          geo = await lookupIp(r.ip);
          geoDone++;
          if (geo) summary.geo_filled++;
        }
        await saveAlive(r, geo);
        summary.new_alive++;
      }
    }
  }

  // 3) Kiểm tra lại proxy cũ nhất
  if (timeLeft() > 45_000) {
    const keys = await oldestChecked(CYCLE_RECHECK);
    const targets: ProxyTarget[] = [];
    for (const k of keys) {
      const p = parseKey(k);
      if (p) targets.push({ ...p, source: "recheck" });
    }
    summary.rechecked = targets.length;
    if (targets.length > 0) {
      const results: CheckResult[] = await checkBatch(targets, myIp, CHECK_CONCURRENCY);
      for (const r of results) {
        if (timeLeft() < 15_000) {
          summary.note = (summary.note ?? "") + " dừng recheck sớm do hết giờ.";
          break;
        }
        if (r.alive) {
          await saveAlive(r, null); // giữ nguyên quốc gia đã có
          summary.still_alive++;
        } else {
          const { pruned } = await recordFail(proxyKey(r));
          if (pruned) summary.pruned++;
        }
      }
    }
  }

  const stats = await getStats().catch(() => null);
  summary.total_alive = stats?.total ?? 0;
  summary.ms = Date.now() - t0;
  return summary;
}
