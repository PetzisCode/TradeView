#!/usr/bin/env python3
"""Holt Kurse (Yahoo Finance) und Nachrichten (Google News) für alle Wertpapiere
aus catalog.json, rechnet in Euro um und schreibt JSON-Dateien für die Web-App.

Aufruf: python3 scripts/fetch_data.py <ausgabe-ordner> [<ordner-mit-alten-daten>]
Nur Standardbibliothek – läuft ohne Installation auf GitHub Actions.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]
DELAY = 0.25


def http_get(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 404:
                break
            time.sleep(2 + i * 3 if e.code == 429 else 1 + i)
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1 + i)
    raise RuntimeError(f"{url}: {last}")


def chart(symbol, rng, interval):
    q = urllib.parse.urlencode({"range": rng, "interval": interval, "includePrePost": "false"})
    sym = urllib.parse.quote(symbol)
    err = None
    for host in HOSTS:
        try:
            raw = http_get(f"https://{host}/v8/finance/chart/{sym}?{q}")
            res = json.loads(raw)["chart"]["result"][0]
            time.sleep(DELAY)
            return res
        except Exception as e:  # noqa: BLE001
            err = e
    raise RuntimeError(f"chart {symbol} {rng}: {err}")


def series(res):
    ts = res.get("timestamp") or []
    try:
        closes = res["indicators"]["quote"][0]["close"]
    except (KeyError, IndexError):
        return []
    adj = None
    try:
        adj = res["indicators"]["adjclose"][0]["adjclose"]
    except (KeyError, IndexError):
        pass
    out = []
    for i, t in enumerate(ts):
        c = closes[i] if i < len(closes) else None
        if c is None:
            continue
        out.append([int(t), float(c)])
    return out


def norm_currency(cur):
    """Liefert (Währung, Faktor) – z. B. britische Pence -> GBP / 100."""
    if cur == "GBp" or cur == "GBX":
        return "GBP", 0.01
    if cur == "ZAc":
        return "ZAR", 0.01
    if cur == "ILA":
        return "ILS", 0.01
    return (cur or "EUR").upper(), 1.0


class FX:
    """Wechselkurse EUR->Fremdwährung, je Tag (Fallback: letzter bekannter Kurs)."""

    def __init__(self):
        self.cache = {}

    def load(self, cur):
        if cur in self.cache or cur == "EUR":
            return
        res = chart(f"EUR{cur}=X", "10y", "1d")
        s = series(res)
        days = {}
        for t, v in s:
            days[datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d")] = v
        latest = res["meta"].get("regularMarketPrice") or (s[-1][1] if s else None)
        self.cache[cur] = {"days": days, "sorted": sorted(days), "latest": latest}

    def rate(self, cur, t=None):
        if cur == "EUR":
            return 1.0
        self.load(cur)
        c = self.cache[cur]
        if t is None:
            return c["latest"]
        d = datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d")
        if d in c["days"]:
            return c["days"][d]
        # letzter Tag davor
        lo, hi = 0, len(c["sorted"]) - 1
        best = None
        while lo <= hi:
            mid = (lo + hi) // 2
            if c["sorted"][mid] <= d:
                best = c["sorted"][mid]
                lo = mid + 1
            else:
                hi = mid - 1
        return c["days"][best] if best else c["latest"]


def r(v):
    if v is None:
        return None
    if abs(v) >= 1000:
        return round(v, 2)
    if abs(v) >= 1:
        return round(v, 4)
    return float(f"{v:.6g}")


def to_eur(s, cur, factor, fx, per_day=True):
    out = []
    for t, v in s:
        rate = fx.rate(cur, t if per_day else None)
        out.append([t, r(v * factor / rate)])
    return out


def value_at(s, t):
    """Schlusskurs am letzten Punkt <= t."""
    best = None
    for tt, v in s:
        if tt <= t:
            best = v
        else:
            break
    return best


def pct(a, b):
    if a is None or b in (None, 0):
        return None
    return round((a / b - 1) * 100, 3)


def news(query):
    q = urllib.parse.quote(f"{query} when:14d")
    url = f"https://news.google.com/rss/search?q={q}&hl=de&gl=DE&ceid=DE:de"
    raw = http_get(url)
    root = ET.fromstring(raw)
    items = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        src_el = it.find("source")
        source = (src_el.text or "").strip() if src_el is not None else ""
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3]
        try:
            ts = int(parsedate_to_datetime(it.findtext("pubDate")).timestamp())
        except Exception:  # noqa: BLE001
            ts = None
        items.append({"t": title, "u": it.findtext("link"), "s": source, "d": ts})
    items.sort(key=lambda x: x["d"] or 0, reverse=True)
    time.sleep(DELAY)
    return items[:12]


def process(item, fx, now):
    sym = item["symbol"]
    intraday = chart(sym, "1d", "5m")
    meta = intraday["meta"]
    cur, factor = norm_currency(meta.get("currency"))
    week = chart(sym, "5d", "30m")
    daily = chart(sym, "2y", "1d")
    weekly = chart(sym, "10y", "1wk")

    rate_now = fx.rate(cur)
    price = meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    price_eur = price * factor / rate_now if price is not None else None
    prev_eur = prev * factor / rate_now if prev is not None else None

    s_intra = to_eur(series(intraday), cur, factor, fx, per_day=False)
    s_week = to_eur(series(week), cur, factor, fx, per_day=False)
    s_daily = to_eur(series(daily), cur, factor, fx)
    s_weekly = to_eur(series(weekly), cur, factor, fx)

    # Für historische Vergleiche: aktuellen Kurs mit historischem EUR-Kurs vergleichen
    def ago(days, src):
        return value_at(src, int((now - timedelta(days=days)).timestamp()))

    year_start = datetime(now.year, 1, 1, tzinfo=timezone.utc)
    ytd_base = value_at(s_daily, int(year_start.timestamp()) - 1)

    chg = {
        "d": pct(price_eur, prev_eur),
        "w": pct(price_eur, ago(7, s_daily)),
        "m": pct(price_eur, ago(30, s_daily)),
        "m6": pct(price_eur, ago(182, s_daily)),
        "ytd": pct(price_eur, ytd_base),
        "y": pct(price_eur, ago(365, s_daily)),
        "y5": pct(price_eur, ago(365 * 5, s_weekly)),
    }
    spark = [v for _, v in s_daily[-30:]]
    summary = {
        "p": r(price_eur),
        "pc": r(prev_eur),
        "c": chg,
        "sp": spark,
        "cur": cur,
        "po": r(price * factor) if price is not None else None,
        "t": meta.get("regularMarketTime"),
        "ex": meta.get("exchangeName"),
    }
    detail = {"intra": s_intra, "week": s_week, "daily": s_daily, "weekly": s_weekly}
    return summary, detail


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data")
    old = sys.argv[2] if len(sys.argv) > 2 else None
    os.makedirs(os.path.join(out, "s"), exist_ok=True)

    with open(os.path.join(ROOT, "catalog.json"), encoding="utf-8") as f:
        catalog = json.load(f)

    old_summary = {}
    if old and os.path.exists(os.path.join(old, "summary.json")):
        try:
            with open(os.path.join(old, "summary.json"), encoding="utf-8") as f:
                old_summary = json.load(f).get("items", {})
        except Exception:  # noqa: BLE001
            pass

    def old_detail(i):
        if not old:
            return None
        p = os.path.join(old, "s", f"{i}.json")
        if os.path.exists(p):
            try:
                with open(p, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:  # noqa: BLE001
                return None
        return None

    fx = FX()
    now = datetime.now(timezone.utc)
    items, errors = {}, []
    for item in catalog:
        iid = item["id"]
        prev_detail = old_detail(iid) or {}
        try:
            summary, detail = process(item, fx, now)
            summary["ok"] = int(now.timestamp())
        except Exception as e:  # noqa: BLE001
            errors.append(f"{iid}: {e}")
            print("FEHLER Kurse", iid, e, file=sys.stderr)
            if iid in old_summary:
                summary = old_summary[iid]
                detail = {k: prev_detail.get(k, []) for k in ("intra", "week", "daily", "weekly")}
            else:
                continue
        try:
            detail["news"] = news(item.get("news") or f"{item['name']} Aktie")
        except Exception as e:  # noqa: BLE001
            print("FEHLER News", iid, e, file=sys.stderr)
            detail["news"] = prev_detail.get("news", [])
        items[iid] = summary
        with open(os.path.join(out, "s", f"{iid}.json"), "w", encoding="utf-8") as f:
            json.dump(detail, f, separators=(",", ":"), ensure_ascii=False)
        print("ok", iid, summary.get("p"))

    fx_now = {c: r(v["latest"]) for c, v in fx.cache.items()}
    with open(os.path.join(out, "summary.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": int(now.timestamp()), "fx": fx_now, "items": items,
                   "errors": errors}, f, separators=(",", ":"), ensure_ascii=False)
    print(f"Fertig: {len(items)} Werte, {len(errors)} Fehler")
    if not items:
        sys.exit(1)


if __name__ == "__main__":
    main()
