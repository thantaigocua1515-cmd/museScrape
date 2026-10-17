"""Lưu trữ SQLite: bảng proxies + harvest_log."""
import sqlite3
from datetime import datetime, timezone

from .config import DATA_DIR, DB_PATH, MAX_FAILS

SCHEMA = """
CREATE TABLE IF NOT EXISTS proxies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  port INTEGER NOT NULL,
  protocol TEXT NOT NULL,          -- http | socks4 | socks5
  country TEXT,
  country_code TEXT,               -- VN, US, ...
  city TEXT,
  tcp_ms REAL,                     -- ping TCP tới proxy (ms)
  http_ms REAL,                    -- latency request qua proxy (ms)
  exit_ip TEXT,
  anonymity TEXT,                  -- elite | anonymous | transparent | unknown
  source TEXT,                     -- nguồn phát hiện
  first_seen TEXT,
  last_checked TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(protocol, ip, port)
);
CREATE INDEX IF NOT EXISTS idx_proto_country ON proxies(protocol, country_code);
CREATE INDEX IF NOT EXISTS idx_last_checked ON proxies(last_checked);

CREATE TABLE IF NOT EXISTS harvest_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT,
  kind TEXT,                       -- harvest | monitor
  fetched INTEGER,
  new_checked INTEGER,
  new_alive INTEGER,
  rechecked INTEGER,
  still_alive INTEGER,
  pruned INTEGER,
  ms INTEGER
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def existing_keys(con: sqlite3.Connection) -> set[tuple]:
    return {
        (r["protocol"], r["ip"], r["port"])
        for r in con.execute("SELECT protocol, ip, port FROM proxies")
    }


def upsert_alive(con: sqlite3.Connection, res: dict, geo: dict | None):
    now = _now()
    con.execute(
        """
        INSERT INTO proxies
          (ip, port, protocol, country, country_code, city, tcp_ms, http_ms,
           exit_ip, anonymity, source, first_seen, last_checked, fail_count, success_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)
        ON CONFLICT(protocol, ip, port) DO UPDATE SET
          country=excluded.country, country_code=excluded.country_code, city=excluded.city,
          tcp_ms=excluded.tcp_ms, http_ms=excluded.http_ms, exit_ip=excluded.exit_ip,
          anonymity=excluded.anonymity, last_checked=excluded.last_checked,
          fail_count=0, success_count=proxies.success_count+1
        """,
        (
            res["ip"], res["port"], res["protocol"],
            (geo or {}).get("country"), (geo or {}).get("country_code"), (geo or {}).get("city"),
            res.get("tcp_ms"), res.get("http_ms"), res.get("exit_ip"), res.get("anonymity"),
            res.get("source"), now, now,
        ),
    )


def mark_failed(con: sqlite3.Connection, res: dict):
    """Proxy chết: tăng fail_count. Chỉ áp dụng cho proxy đã có trong DB."""
    con.execute(
        "UPDATE proxies SET fail_count = fail_count + 1, last_checked = ? "
        "WHERE protocol=? AND ip=? AND port=?",
        (_now(), res["protocol"], res["ip"], res["port"]),
    )


def prune_dead(con: sqlite3.Connection, max_fails: int = MAX_FAILS) -> int:
    """Xoá proxy chết quá max_fails lần liên tiếp. Trả về số dòng đã xoá."""
    cur = con.execute("DELETE FROM proxies WHERE fail_count >= ?", (max_fails,))
    return cur.rowcount


def oldest_for_recheck(con: sqlite3.Connection, limit: int) -> list[dict]:
    rows = con.execute(
        "SELECT protocol, ip, port, source FROM proxies ORDER BY last_checked ASC LIMIT ?",
        (limit,),
    )
    return [dict(r) for r in rows]


def missing_geo(con: sqlite3.Connection, limit: int = 500) -> list[dict]:
    rows = con.execute(
        "SELECT protocol, ip, port FROM proxies "
        "WHERE fail_count = 0 AND country_code IS NULL LIMIT ?",
        (limit,),
    )
    return [dict(r) for r in rows]


def update_geo(con: sqlite3.Connection, protocol: str, ip: str, port: int, geo: dict):
    con.execute(
        "UPDATE proxies SET country=?, country_code=?, city=? "
        "WHERE protocol=? AND ip=? AND port=?",
        (geo.get("country"), geo.get("country_code"), geo.get("city"),
         protocol, ip, port),
    )


def log_run(con: sqlite3.Connection, kind: str, stats: dict, ms: int):
    con.execute(
        "INSERT INTO harvest_log (ts, kind, fetched, new_checked, new_alive, rechecked,"
        " still_alive, pruned, ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (_now(), kind, stats.get("fetched", 0), stats.get("new_checked", 0),
         stats.get("new_alive", 0), stats.get("rechecked", 0),
         stats.get("still_alive", 0), stats.get("pruned", 0), ms),
    )


def get_proxies(
    con: sqlite3.Connection,
    protocol: str | None = None,
    country_code: str | None = None,
    limit: int = 50,
) -> list[dict]:
    q = ("SELECT ip, port, protocol, country, country_code, city, tcp_ms, http_ms,"
         " exit_ip, anonymity, source, last_checked, success_count FROM proxies"
         " WHERE fail_count = 0")
    args: list = []
    if protocol:
        q += " AND protocol = ?"
        args.append(protocol)
    if country_code:
        q += " AND country_code = ?"
        args.append(country_code.upper())
    q += " ORDER BY http_ms ASC LIMIT ?"
    args.append(min(limit, 500))
    return [dict(r) for r in con.execute(q, args)]


def stats(con: sqlite3.Connection) -> dict:
    s: dict = {"total": 0, "by_protocol": {}, "by_country": {}, "avg_http_ms": None}
    s["total"] = con.execute(
        "SELECT COUNT(*) c FROM proxies WHERE fail_count = 0"
    ).fetchone()["c"]
    for r in con.execute(
        "SELECT protocol, COUNT(*) c FROM proxies WHERE fail_count = 0 GROUP BY protocol"
    ):
        s["by_protocol"][r["protocol"]] = r["c"]
    for r in con.execute(
        "SELECT country_code, COUNT(*) c FROM proxies WHERE fail_count = 0"
        " AND country_code IS NOT NULL GROUP BY country_code ORDER BY c DESC LIMIT 20"
    ):
        s["by_country"][r["country_code"]] = r["c"]
    row = con.execute(
        "SELECT AVG(http_ms) a FROM proxies WHERE fail_count = 0 AND http_ms IS NOT NULL"
    ).fetchone()
    s["avg_http_ms"] = round(row["a"], 1) if row["a"] else None
    last = con.execute(
        "SELECT ts, kind FROM harvest_log ORDER BY id DESC LIMIT 1"
    ).fetchone()
    s["last_run"] = dict(last) if last else None
    return s
