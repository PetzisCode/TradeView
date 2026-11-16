#!/usr/bin/env python3
"""Holt Kurse (onvista, bevorzugt LS Exchange = Handelsplatz von Trade Republic) und
Nachrichten (Google News) für alle Wertpapiere aus catalog.json und schreibt JSON-Dateien
für die Web-App.

Aufruf: python3 scripts/fetch_data.py <ausgabe-ordner> [<ordner-mit-alten-daten>]
Nur Standardbibliothek – läuft ohne Installation auf GitHub Actions.
"""
import html
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.onvista.de/api/v1"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 "
      "(KHTML, like Gecko) Version/17.0 Safari/605.1.15")
DELAY = 0.3
BERLIN = ZoneInfo("Europe/Berlin")
# Bevorzugte Handelsplätze: LS Exchange / Lang & Schwarz (Trade Republic), dann Tradegate, Xetra …
MARKETS = ["_LSX", "@_LUSG", "_GAT", "_GER", "_TRO", "@_BBF", "_FRA", "_STU", "_BFN"]
ENTITY_PATH = {"aktie": "stocks", "etf": "funds"}


def http_get(url, tries=3, accept="application/json"):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept,
                                                       "Accept-Language": "de-DE,de;q=0.9"})
            with urllib.request.urlopen(req, timeout=25) as r:
                data = r.read()
            time.sleep(DELAY)
            return data
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (400, 403, 404):
                break
            time.sleep(2 + i * 3)
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1 + i * 2)
    raise RuntimeError(f"{url}: {last}")


def get_json(url):
    return json.loads(http_get(url))


def r(v):
    if v is None:
        return None
    if abs(v) >= 1000:
        return round(v, 2)
    if abs(v) >= 1:
        return round(v, 4)
    return float(f"{v:.6g}")


def pct(a, b):
    if a is None or b in (None, 0):
        return None
    return round((a / b - 1) * 100, 3)


def value_at(s, t):
    best = None
    for tt, v in s:
        if tt <= t:
            best = v
        else:
            break
    return best


def ts(iso):
    if not iso:
        return None
    try:
        return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return None


class ECB:
    """Wechselkurse (Fremdwährung je Euro) der EZB – nur für den seltenen Fall ohne Euro-Kurs."""
    cache = {}

    @classmethod
    def rate(cls, cur):
        cur = (cur or "EUR").upper()
        if cur == "EUR":
            return 1.0
        if cur not in cls.cache:
            raw = http_get(f"https://data-api.ecb.europa.eu/service/data/EXR/D.{cur}.EUR.SP00.A"
                           f"?format=csvdata&lastNObservations=1", accept="text/csv").decode()
            rows = raw.strip().splitlines()
            head = rows[0].split(",")
            cls.cache[cur] = float(rows[-1].split(",")[head.index("OBS_VALUE")])
        return cls.cache[cur]


def snapshot(item, ref):
    if item.get("onvista"):
        return get_json(f"{API}/instruments/{item['onvista']}/snapshot")
    if ref.get("et") and ref.get("ev"):
        return get_json(f"{API}/instruments/{ref['et']}/{ref['ev']}/snapshot")
    path = ENTITY_PATH.get(item["type"])
    if path:
        try:
            return get_json(f"{API}/{path}/ISIN:{item['isin']}/snapshot")
        except RuntimeError:
            pass
    # Fallback: über die Suche Typ und ID ermitteln (z. B. ETCs)
    res = get_json(f"{API}/instruments/query?searchValue={item['isin']}&limit=3")
    for x in res.get("list", []):
        if x.get("isin") == item["isin"]:
            return get_json(f"{API}/instruments/{x['entityType']}/{x['entityValue']}/snapshot")
    raise RuntimeError("nicht gefunden")


def pick_quote(snap):
    ql = (snap.get("quoteList") or {}).get("list") or []
    for code in MARKETS:
        for q in ql:
            if q.get("market", {}).get("codeMarket") == code and q.get("isoCurrency") == "EUR" and q.get("last"):
                return q
    for q in ql:
        if q.get("isoCurrency") == "EUR" and q.get("last"):
            return q
    if (snap.get("quote") or {}).get("last"):
        return snap["quote"]
    for q in ql:
        if q.get("last"):
            return q
    raise RuntimeError("kein Kurs")


def process(item, ref, now, old_detail=None):
    snap = snapshot(item, ref)
    inst = snap["instrument"]
    et, ev = inst["entityType"], inst["entityValue"]
    q = pick_quote(snap)
    nid = q["market"]["idNotation"]
    fx = ECB.rate(q.get("isoCurrency"))

    def conv(v):
        return None if v is None else v / fx

    price = conv(q.get("last"))
    prev = conv(q.get("previousLast"))
    t_last = ts(q.get("datetimeLast")) or int(now.timestamp())

    # Tagesschlusskurse der letzten 5 Jahre
    start = (now.date() - timedelta(days=5 * 366)).isoformat()
    eod = get_json(f"{API}/instruments/{et}/{ev}/eod_history?idNotation={nid}&range=Y5&startDate={start}")
    daily = [[int(t), r(conv(v))] for t, v in zip(eod.get("datetimeLast", []), eod.get("last", [])) if v is not None]
    daily.sort()
    if price is not None and (not daily or daily[-1][0] < t_last - 6 * 3600):
        daily.append([t_last, r(price)])

    # Verlauf der letzten Woche (Stundenwerte) – daraus auch der Tagesverlauf
    wk_start = (now.date() - timedelta(days=8)).isoformat()
    try:
        w = get_json(f"{API}/instruments/{et}/{ev}/simple_chart_history?chartType=PRICE"
                     f"&endDate={now.date().isoformat()}&idNotation={nid}&interval=W1&startDate={wk_start}")
        week = [[int(t / 1000), r(conv(v))] for t, v in zip(w.get("datetimeTick", []), w.get("tick", [])) if v is not None]
    except RuntimeError:
        week = []
    # mit früheren Abrufen zusammenführen, damit der laufende Tag lückenlos wird
    od = old_detail or {}
    week_cut = int((now - timedelta(days=8)).timestamp())
    merged = {t: v for t, v in (od.get("week") or []) if t >= week_cut and v is not None}
    for t, v in week:
        merged[t] = v
    if price is not None:
        merged[t_last] = r(price)
    week = sorted([[t, v] for t, v in merged.items()])
    intra = []
    if week:
        last_day = datetime.fromtimestamp(week[-1][0], BERLIN).date()
        intra = [p for p in week if datetime.fromtimestamp(p[0], BERLIN).date() == last_day]
        if prev is not None and intra:
            day_start = int(datetime.combine(last_day, datetime.min.time(), BERLIN).timestamp())
            open_t = min(intra[0][0] - 1800, day_start + 8 * 3600)
            if intra[0][0] > open_t:
                intra = [[open_t, r(prev)]] + intra

    # Wochenwerte für 5 Jahre (letzter Kurs je Kalenderwoche)
    weekly, seen = [], {}
    for t, v in daily:
        k = datetime.fromtimestamp(t, timezone.utc).isocalendar()[:2]
        if k in seen:
            weekly[seen[k]] = [t, v]
        else:
            seen[k] = len(weekly)
            weekly.append([t, v])

    def ago(days):
        return value_at(daily, int((now - timedelta(days=days)).timestamp()))

    ytd_base = value_at(daily, int(datetime(now.year, 1, 1, tzinfo=BERLIN).timestamp()) - 1)
    has_5y = bool(daily) and daily[0][0] < (now - timedelta(days=365 * 5 - 10)).timestamp()
    chg = {
        "d": pct(price, prev),
        "w": pct(price, ago(7)),
        "m": pct(price, ago(30)),
        "m6": pct(price, ago(182)),
        "ytd": pct(price, ytd_base),
        "y": pct(price, ago(365)),
        "y5": pct(price, ago(365 * 5)) if has_5y else None,
    }
    summary = {
        "p": r(price), "pc": r(prev), "c": chg,
        "sp": [v for _, v in daily[-30:]],
        "t": t_last,
        "ex": q["market"].get("name"),
        "cur": q.get("isoCurrency"),
        "ref": {"et": et, "ev": ev},
    }
    two_years = (now - timedelta(days=740)).timestamp()
    detail = {"intra": intra, "week": week, "daily": [p for p in daily if p[0] >= two_years], "weekly": weekly}
    return summary, detail


def bing_news(query):
    """Bing-News-RSS: enthält die echte Artikel-Adresse (Parameter url=), daher direkt aufrufbar."""
    q = urllib.parse.quote(query)
    root = None
    for _ in range(3):
        raw = http_get(f"https://www.bing.com/news/search?q={q}&format=rss&setlang=de-DE&cc=DE",
                       accept="application/rss+xml")
        try:
            root = ET.fromstring(raw)
            break
        except ET.ParseError:
            time.sleep(2)
    if root is None:
        raise RuntimeError("Bing lieferte kein RSS")
    items = []
    for it in root.iter("item"):
        link = it.findtext("link") or ""
        real = urllib.parse.parse_qs(urllib.parse.urlparse(link).query).get("url", [None])[0]
        title = html.unescape((it.findtext("title") or "").strip())
        if not real or not real.startswith("http") or len(title) < 15 or " teilen" in title:
            continue
        if "/chart/" in real or "kursprognose" in real.lower():
            continue
        source = ""
        for ch in it:
            if ch.tag.endswith("Source") and ch.text:
                source = ch.text.strip()
        if not source:
            source = urllib.parse.urlparse(real).netloc.replace("www.", "")
        try:
            t = int(parsedate_to_datetime(it.findtext("pubDate")).timestamp())
        except Exception:  # noqa: BLE001
            t = None
        items.append({"t": title, "u": real, "s": source, "d": t})
    return items


def google_news(query):
    q = urllib.parse.quote(f"{query} when:14d")
    raw = http_get(f"https://news.google.com/rss/search?q={q}&hl=de&gl=DE&ceid=DE:de",
                   accept="application/rss+xml")
    root = ET.fromstring(raw)
    items = []
    for it in root.iter("item"):
        title = (it.findtext("title") or "").strip()
        src_el = it.find("source")
        source = (src_el.text or "").strip() if src_el is not None else ""
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3]
        # Google-Links landen auf dem iPhone oft auf einer Sperrseite -> Startseite der Quelle verlinken
        home = src_el.get("url") if src_el is not None else None
        try:
            t = int(parsedate_to_datetime(it.findtext("pubDate")).timestamp())
        except Exception:  # noqa: BLE001
            t = None
        if home:
            items.append({"t": title, "u": home, "s": source, "d": t})
    return items


def news(query):
    items = []
    try:
        items = bing_news(query)
    except Exception as e:  # noqa: BLE001
        print("Bing-Fehler", query, e, file=sys.stderr, flush=True)
    if len(items) < 3:
        items += google_news(query)
    seen, out = set(), []
    for x in sorted(items, key=lambda x: x["d"] or 0, reverse=True):
        key = x["t"].lower()[:60]
        if key in seen:
            continue
        seen.add(key)
        out.append(x)
    return out[:12]


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data")
    old = sys.argv[2] if len(sys.argv) > 2 else None
    os.makedirs(os.path.join(out, "s"), exist_ok=True)

    with open(os.path.join(ROOT, "catalog.json"), encoding="utf-8") as f:
        catalog = json.load(f)
    limit = int(os.environ.get("LIMIT", "0") or 0)
    if limit:
        catalog = catalog[:limit]

    old_summary = {}
    if old and os.path.exists(os.path.join(old, "summary.json")):
        try:
            with open(os.path.join(old, "summary.json"), encoding="utf-8") as f:
                old_summary = json.load(f).get("items", {})
        except Exception:  # noqa: BLE001
            pass

    def old_detail(i):
        p = os.path.join(old or "", "s", f"{i}.json")
        if old and os.path.exists(p):
            try:
                with open(p, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:  # noqa: BLE001
                return None
        return None

    now = datetime.now(timezone.utc)
    # Nachrichten nur etwa stündlich neu laden (spart Anfragen)
    refresh_news = now.minute < 20 or not old_summary
    items, errors = {}, []
    for item in catalog:
        iid = item["id"]
        prev_detail = old_detail(iid) or {}
        prev_sum = old_summary.get(iid, {})
        try:
            summary, detail = process(item, prev_sum.get("ref") or {}, now, prev_detail)
            summary["ok"] = int(now.timestamp())
        except Exception as e:  # noqa: BLE001
            errors.append(f"{iid}: {e}")
            print("FEHLER Kurse", iid, e, file=sys.stderr, flush=True)
            if not prev_sum:
                continue
            summary = prev_sum
            detail = {k: prev_detail.get(k, []) for k in ("intra", "week", "daily", "weekly")}
        old_news = prev_detail.get("news") or []
        if refresh_news or not old_news or any("news.google.com" in (n.get("u") or "") for n in old_news):
            try:
                detail["news"] = news(item.get("news") or f"{item['name']} Aktie")
            except Exception as e:  # noqa: BLE001
                print("FEHLER News", iid, e, file=sys.stderr, flush=True)
                detail["news"] = prev_detail.get("news", [])
        else:
            detail["news"] = prev_detail.get("news", [])
        items[iid] = summary
        with open(os.path.join(out, "s", f"{iid}.json"), "w", encoding="utf-8") as f:
            json.dump(detail, f, separators=(",", ":"), ensure_ascii=False)
        print("ok", iid, summary.get("p"), summary.get("ex"), flush=True)

    with open(os.path.join(out, "summary.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": int(now.timestamp()), "items": items, "errors": errors},
                  f, separators=(",", ":"), ensure_ascii=False)
    print(f"Fertig: {len(items)} Werte, {len(errors)} Fehler", flush=True)


if __name__ == "__main__":
    main()
