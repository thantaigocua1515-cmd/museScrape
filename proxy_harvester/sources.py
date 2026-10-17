"""Tải + parse danh sách proxy từ các nguồn công khai, khử trùng lặp."""
import asyncio
import re

import aiohttp

from .config import SOURCES, TRUST_ENV, USER_AGENT

# Chấp nhận: "1.2.3.4:8080", "http://1.2.3.4:8080", "socks5://1.2.3.4:1080"
LINE_RE = re.compile(r"^(?:(?:https?|socks[45])://)?(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$")


def parse_lines(text: str, protocol: str, source: str) -> list[dict]:
    """Parse text thành list dict {protocol, ip, port, source}."""
    out = []
    for raw in text.splitlines():
        line = raw.strip().strip(",").strip('"').strip("'")
        m = LINE_RE.match(line)
        if not m:
            continue
        ip, port = m.group(1), int(m.group(2))
        if not 1 <= port <= 65535:
            continue
        try:
            octs = [int(x) for x in ip.split(".")]
        except ValueError:
            continue
        if any(o > 255 for o in octs):
            continue
        if ip == "0.0.0.0" or ip.startswith("127.") or ip.startswith("0."):
            continue
        out.append({"protocol": protocol, "ip": ip, "port": port, "source": source})
    return out


async def fetch_one(session: aiohttp.ClientSession, name: str, url: str, protocol: str) -> list[dict]:
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as r:
            if r.status != 200:
                return []
            text = await r.text()
            return parse_lines(text, protocol, name)
    except Exception:
        return []


async def fetch_all() -> list[dict]:
    """Tải tất cả nguồn, trả về list proxy đã khử trùng theo (protocol, ip, port)."""
    async with aiohttp.ClientSession(
        headers={"User-Agent": USER_AGENT}, trust_env=TRUST_ENV
    ) as s:
        batches = await asyncio.gather(
            *[fetch_one(s, name, url, proto) for name, url, proto in SOURCES]
        )
    seen: set[tuple] = set()
    uniq: list[dict] = []
    for batch in batches:
        for pr in batch:
            key = (pr["protocol"], pr["ip"], pr["port"])
            if key not in seen:
                seen.add(key)
                uniq.append(pr)
    return uniq
