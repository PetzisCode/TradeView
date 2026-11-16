import json, urllib.request, datetime
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":UA,"Accept":"application/json"}),timeout=20) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()[:300]
    except Exception as e: return 0, str(e).encode()
def show(u, n=500):
    s,b=get(u); print("===",u,"->",s,len(b)); print(b[:n].decode('utf8','replace')); return s,b
s,b=get("https://api.onvista.de/api/v1/stocks/ISIN:US0378331005/snapshot")
d=json.loads(b); print("KEYS", list(d.keys()))
for k,v in d.items():
    if isinstance(v,dict): print(" ",k, list(v.keys())[:25])
print("quote:", json.dumps(d.get("quote"))[:800])
ql=d.get("quoteList",{}).get("list",[])
for q in ql: print("Q", q.get("market",{}).get("name"), q.get("market",{}).get("codeMarket"), q.get("market",{}).get("idNotation") or q.get("idNotation"), q.get("isoCurrency"), q.get("last"), q.get("datetimeLast"))
eid=d["instrument"]["entityValue"]
nid=None
for q in ql:
    if q.get("market",{}).get("codeMarket") in ("LUS","LSX","TGT","GER"): nid=q["market"].get("idNotation"); print("chosen",q["market"]); break
if not nid and ql: nid=ql[0]["market"].get("idNotation")
today=datetime.date.today(); y=today-datetime.timedelta(days=365)
B="https://api.onvista.de/api/v1/instruments/STOCK/%s"%eid
for u in [f"{B}/eod_history?idNotation={nid}&range=Y1&startDate={y}",
          f"{B}/eod_history?idNotation={nid}&range=Y5&startDate={today-datetime.timedelta(days=1826)}",
          f"{B}/chart_history?endDate={today}&idNotation={nid}&resolution=1D&startDate={y}",
          f"{B}/simple_chart_history?chartType=PRICE&endDate={today}&idNotation={nid}&interval=D1&startDate={today-datetime.timedelta(days=3)}",
          f"{B}/simple_chart_history?chartType=PRICE&endDate={today}&idNotation={nid}&interval=W1&startDate={today-datetime.timedelta(days=8)}",
          f"{B}/times_and_sales?idNotation={nid}&order=DESC&limit=5",
          ]:
    show(u, 700)
s,b=show("https://api.onvista.de/api/v1/funds/ISIN:IE00B4L5Y983/snapshot",0)
d=json.loads(b); print("FUND KEYS", list(d.keys()))
for q in d.get("quoteList",{}).get("list",[]): print("FQ", q.get("market",{}).get("name"), q.get("market",{}).get("codeMarket"), q.get("market",{}).get("idNotation"), q.get("isoCurrency"), q.get("last"))
show("https://api.onvista.de/api/v1/instruments/query?searchValue=Bitcoin&limit=3",600)
show("https://api.onvista.de/api/v1/instruments/query?searchValue=DE000A0S9GB0",400)
show("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=eur&days=1825&interval=daily",200)
