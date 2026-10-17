#!/usr/bin/env python3
"""Giám sát 24/7: mỗi vòng sẽ
  1. Tải proxy mới từ các nguồn -> kiểm tra -> thêm vào DB
  2. Kiểm tra lại proxy cũ trong DB (lâu nhất chưa check trước)
  3. Proxy chết >= MAX_FAILS lần liên tiếp -> XOÁ khỏi DB
  4. Điền quốc gia còn thiếu

Dùng:
  python monitor.py --once            # chạy 1 vòng rồi thoát (cho cron)
  python monitor.py --daemon          # chạy vòng lặp liên tục
  python monitor.py --daemon --interval 3600
"""
import argparse
import asyncio
import signal
import sys
import time

import aiohttp

sys.path.insert(0, __file__.rsplit("/", 1)[0])

from proxy_harvester import checker, db, geo, sources  # noqa: E402
from proxy_harvester.config import (  # noqa: E402
    MONITOR_INTERVAL,
    RECHECK_BATCH,
    TRUST_ENV,
    USER_AGENT,
)

_stop = False


def _on_signal(signum, frame):
    global _stop
    _stop = True
    print("\n>> Nhận tín hiệu dừng, sẽ thoát sau vòng hiện tại...", flush=True)


async def fill_geo(con, limit: int = 200):
    """Điền quốc gia cho proxy còn thiếu (giới hạn tốc độ theo ip-api.com)."""
    pending = db.missing_geo(con, limit)
    if not pending:
        return 0
    print(f">> Điền quốc gia cho {len(pending)} proxy...", flush=True)
    limiter = geo.GeoLimiter()
    n = 0
    async with aiohttp.ClientSession(
        headers={"User-Agent": USER_AGENT}, trust_env=TRUST_ENV
    ) as s:
        for p in pending:
            g = await geo.lookup_ip(s, limiter, p["ip"])
            if g:
                db.update_geo(con, p["protocol"], p["ip"], p["port"], g)
                n += 1
    con.commit()
    return n


async def cycle() -> dict:
    t0 = time.perf_counter()
    con = db.connect()
    stats = {"fetched": 0, "new_checked": 0, "new_alive": 0,
             "rechecked": 0, "still_alive": 0, "pruned": 0}
    try:
        # 1) Proxy mới từ các nguồn
        all_proxies = await sources.fetch_all()
        stats["fetched"] = len(all_proxies)
        known = db.existing_keys(con)
        new = [p for p in all_proxies if (p["protocol"], p["ip"], p["port"]) not in known]
        stats["new_checked"] = len(new)

        my_ip = await checker.get_my_ip()
        if new:
            print(f">> Vòng mới: {len(new)} proxy mới cần kiểm tra", flush=True)
            for res in await checker.check_batch(new, my_ip):
                if res["alive"]:
                    db.upsert_alive(con, res, None)  # geo điền sau, tránh nghẽn
                    stats["new_alive"] += 1
            con.commit()

        # 2) Kiểm tra lại proxy cũ (ưu tiên proxy lâu chưa check)
        old = db.oldest_for_recheck(con, RECHECK_BATCH)
        stats["rechecked"] = len(old)
        if old:
            print(f">> Kiểm tra lại {len(old)} proxy cũ...", flush=True)
            for res in await checker.check_batch(old, my_ip):
                if res["alive"]:
                    db.upsert_alive(con, res, None)
                    stats["still_alive"] += 1
                else:
                    db.mark_failed(con, res)
            con.commit()

        # 3) Điền quốc gia còn thiếu
        await fill_geo(con)

        # 4) Xoá proxy chết
        stats["pruned"] = db.prune_dead(con)
        con.commit()

        ms = int((time.perf_counter() - t0) * 1000)
        db.log_run(con, "monitor", stats, ms)
        con.commit()
        s = db.stats(con)
        print(f">> Vòng xong trong {ms/1000:.1f}s | "
              f"mới sống: {stats['new_alive']}/{stats['new_checked']} | "
              f"cũ còn sống: {stats['still_alive']}/{stats['rechecked']} | "
              f"đã xoá: {stats['pruned']} | "
              f"tổng sống trong DB: {s['total']}", flush=True)
    finally:
        con.close()
    return stats


async def daemon(interval: int):
    print(f">> Monitor 24/7 bắt đầu, mỗi vòng cách nhau {interval}s. Ctrl+C để dừng.",
          flush=True)
    while not _stop:
        try:
            await cycle()
        except Exception as e:
            print(f">> Lỗi vòng monitor: {e}", flush=True)
        for _ in range(interval):
            if _stop:
                break
            await asyncio.sleep(1)
    print(">> Monitor đã dừng.", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="Chạy 1 vòng rồi thoát (dùng cho cron)")
    ap.add_argument("--daemon", action="store_true", help="Chạy vòng lặp liên tục")
    ap.add_argument("--interval", type=int, default=MONITOR_INTERVAL,
                    help=f"Giây giữa các vòng (mặc định {MONITOR_INTERVAL})")
    args = ap.parse_args()

    signal.signal(signal.SIGINT, _on_signal)
    signal.signal(signal.SIGTERM, _on_signal)

    if args.once:
        asyncio.run(cycle())
    else:
        asyncio.run(daemon(args.interval))


if __name__ == "__main__":
    main()
