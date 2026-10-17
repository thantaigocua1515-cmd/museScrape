"""Tra cứu quốc gia của IP qua ip-api.com (free 45 req/phút, không cần key)."""
import asyncio
import time

import aiohttp

from .config import GEO_PER_MINUTE, GEO_URL, TRUST_ENV, USER_AGENT


class GeoLimiter:
    """Giới hạn tốc độ gọi API geo."""

    def __init__(self, per_minute: int = GEO_PER_MINUTE):
        self.min_interval = 60.0 / per_minute
        self._lock = asyncio.Lock()
        self._last = 0.0

    async def wait(self):
        async with self._lock:
            now = time.monotonic()
            dt = now - self._last
            if dt < self.min_interval:
                await asyncio.sleep(self.min_interval - dt)
            self._last = time.monotonic()


async def lookup_ip(session: aiohttp.ClientSession, limiter: GeoLimiter, ip: str) -> dict | None:
    """Trả về {country, country_code, city} hoặc None nếu thất bại."""
    await limiter.wait()
    try:
        timeout = aiohttp.ClientTimeout(total=15)
        async with session.get(
            GEO_URL.format(ip=ip),
            timeout=timeout,
            headers={"User-Agent": USER_AGENT},
        ) as r:
            if r.status != 200:
                return None
            d = await r.json()
            if d.get("status") != "success":
                return None
            return {
                "country": d.get("country"),
                "country_code": d.get("countryCode"),
                "city": d.get("city"),
            }
    except Exception:
        return None
