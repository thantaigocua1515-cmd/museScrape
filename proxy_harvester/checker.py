"""Kiểm tra proxy bất đồng bộ: TCP ping + HTTP qua proxy + exit IP + anonymity."""
import asyncio
import json
import time

import aiohttp
from aiohttp_socks import ProxyConnector

from .config import (
    CHECK_HEADERS_URL,
    CHECK_IP_URL,
    CONNECT_TIMEOUT,
    MAX_CONCURRENCY,
    REQUEST_TIMEOUT,
    TRUST_ENV,
    USER_AGENT,
)

_SEM = asyncio.Semaphore(MAX_CONCURRENCY)


async def tcp_ping(ip: str, port: int, timeout: int = CONNECT_TIMEOUT) -> tuple[float | None, bool]:
    """Đo thời gian TCP connect tới proxy (tương đương ping tới host:port)."""
    t0 = time.perf_counter()
    try:
        _r, w = await asyncio.wait_for(asyncio.open_connection(ip, port), timeout)
        w.close()
        try:
            await w.wait_closed()
        except Exception:
            pass
        return (time.perf_counter() - t0) * 1000.0, True
    except Exception:
        return None, False


async def get_my_ip() -> str | None:
    """IP trực tiếp của máy (không qua proxy) - dùng để phân loại anonymity."""
    try:
        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(
            timeout=timeout, headers={"User-Agent": USER_AGENT}, trust_env=TRUST_ENV
        ) as s:
            async with s.get(CHECK_IP_URL) as r:
                if r.status == 200:
                    return json.loads(await r.text()).get("ip")
    except Exception:
        pass
    return None


def _dead(proxy: dict, reason: str) -> dict:
    return {**proxy, "alive": False, "reason": reason}


async def check_one(proxy: dict, my_ip: str | None = None) -> dict:
    """Kiểm tra 1 proxy. Trả về dict có alive, tcp_ms, http_ms, exit_ip, anonymity."""
    protocol, ip, port = proxy["protocol"], proxy["ip"], proxy["port"]

    tcp_ms, tcp_ok = await tcp_ping(ip, port)
    if not tcp_ok:
        return _dead(proxy, "tcp_failed")

    timeout = aiohttp.ClientTimeout(total=REQUEST_TIMEOUT, connect=CONNECT_TIMEOUT)
    headers = {"User-Agent": USER_AGENT}
    try:
        if protocol in ("socks4", "socks5"):
            connector = ProxyConnector.from_url(f"{protocol}://{ip}:{port}")
            session = aiohttp.ClientSession(
                connector=connector, timeout=timeout, headers=headers, trust_env=TRUST_ENV
            )
            req_kw: dict = {}
        else:
            session = aiohttp.ClientSession(
                timeout=timeout, headers=headers, trust_env=TRUST_ENV
            )
            req_kw = {"proxy": f"http://{ip}:{port}"}

        async with session:
            # 1) Liveness + latency + exit IP
            t0 = time.perf_counter()
            async with session.get(CHECK_IP_URL, **req_kw) as r:
                if r.status != 200:
                    return _dead(proxy, f"http_{r.status}")
                exit_ip = json.loads(await r.text()).get("ip")
            http_ms = (time.perf_counter() - t0) * 1000.0
            if not exit_ip:
                return _dead(proxy, "no_exit_ip")

            # 2) Anonymity: xem proxy có forward header không
            anonymity = "unknown"
            try:
                async with session.get(CHECK_HEADERS_URL, **req_kw) as r2:
                    if r2.status == 200:
                        h = (await r2.text()).lower()
                        forwarded = any(
                            k in h
                            for k in ("x-forwarded-for", '"via"', "forwarded", "proxy-connection")
                        )
                        if my_ip and exit_ip == my_ip:
                            anonymity = "transparent"
                        elif forwarded:
                            anonymity = "anonymous"
                        else:
                            anonymity = "elite"
            except Exception:
                pass

        return {
            **proxy,
            "alive": True,
            "tcp_ms": round(tcp_ms, 1),
            "http_ms": round(http_ms, 1),
            "exit_ip": exit_ip,
            "anonymity": anonymity,
        }
    except Exception as e:
        return _dead(proxy, f"error:{type(e).__name__}")


async def _guarded(proxy: dict, my_ip: str | None) -> dict:
    async with _SEM:
        return await check_one(proxy, my_ip)


async def check_batch(proxies: list[dict], my_ip: str | None = None) -> list[dict]:
    """Check hàng loạt proxy song song (giới hạn bởi MAX_CONCURRENCY)."""
    return await asyncio.gather(*[_guarded(p, my_ip) for p in proxies])
