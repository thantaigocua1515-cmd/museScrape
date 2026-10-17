#!/usr/bin/env python3
"""Chạy 1 lần: tải proxy mới từ các nguồn -> kiểm tra -> lưu DB.

Dùng: python harvest.py [--limit N] [--no-geo]
"""
import argparse
import asyncio
import sys
import time

import aiohttp

sys.path.insert(0, __file__.rsplit("/", 1)[0])

from proxy_harvester import checker, db, geo, sources  # noqa: E402
from proxy_harvester.config import TRUST_ENV, USER_AGENT  # noqa: E402


async def enrich_geo(new_alive: list[dict], con, do_geo: bool):
    if not do_geo:
        return
    limiter = geo.GeoLimiter()
    async with aiohttp.ClientSession(
        headers={"User-Agent": USER_AGENT}, trust_env=TRUST_ENV
    ) as s:
        for res in new_alive:
            g = await geo.lookup_ip(s, limiter, res["ip"])
            db.upsert_alive(con, res, g)
            con.commit()
            flag = g["country_code"] if g else "??"
            print(f"  + {res['protocol']}://{res['ip']}:{res['port']} "
                  f"{res['http_ms']}ms [{flag}] {res['anonymity']}", flush=True)


async def main_async(limit: int | None, do_geo: bool):
    t0 = time.perf_counter()
    con = db.connect()

    print(">> Đang tải danh sách proxy từ các nguồn...", flush=True)
    all_proxies = await sources.fetch_all()
    print(f">> Tải được {len(all_proxies)} proxy (đã khử trùng)", flush=True)

    known = db.existing_keys(con)
    candidates = [p for p in all_proxies if (p["protocol"], p["ip"], p["port"]) not in known]
    if limit:
        candidates = candidates[:limit]
    print(f">> Có {len(candidates)} proxy mới cần kiểm tra", flush=True)
    if not candidates:
        con.close()
        return {"fetched": len(all_proxies), "new_checked": 0, "new_alive": 0,
                "rechecked": 0, "still_alive": 0, "pruned": 0}

    my_ip = await checker.get_my_ip()
    print(f">> IP trực tiếp của máy: {my_ip}", flush=True)

    print(">> Đang kiểm tra proxy (song song)...", flush=True)
    results = await checker.check_batch(candidates, my_ip)
    alive = [r for r in results if r["alive"]]
    dead = len(results) - len(alive)
    print(f">> Sống: {len(alive)} / Chết: {dead}", flush=True)

    print(">> Đang tra cứu quốc gia + lưu DB...", flush=True)
    await enrich_geo(alive, con, do_geo)

    stats = {"fetched": len(all_proxies), "new_checked": len(candidates),
             "new_alive": len(alive), "rechecked": 0, "still_alive": 0, "pruned": 0}
    ms = int((time.perf_counter() - t0) * 1000)
    db.log_run(con, "harvest", stats, ms)
    con.commit()
    con.close()
    print(f">> Xong trong {ms/1000:.1f}s", flush=True)
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None, help="Giới hạn số proxy mới để test nhanh")
    ap.add_argument("--no-geo", action="store_true", help="Bỏ qua tra cứu quốc gia")
    args = ap.parse_args()
    asyncio.run(main_async(args.limit, not args.no_geo))


if __name__ == "__main__":
    main()
