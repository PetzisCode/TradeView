import json, urllib.request, urllib.parse, datetime, time
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":UA,"Accept":"application/json"}),timeout=20) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, e.read()[:200]
API="https://api.onvista.de/api/v1"
today=datetime.date.today()
s,d=get(f"{API}/stocks/ISIN:US0378331005/snapshot")
q=[x for x in d["quoteList"]["list"] if x["market"]["codeMarket"]=="_LSX"][0]
print("QL ITEM KEYS", sorted(q.keys())); print(json.dumps(q)[:900])
n=q["market"]["idNotation"]
s,e=get(f"{API}/instruments/STOCK/86627/eod_history?idNotation={n}&range=Y5&startDate={today-datetime.timedelta(days=1830)}")
print("EOD", s, {k:(v[:3] if isinstance(v,list) else v) for k,v in e.items()} if s==200 else e)
for st in [today, today-datetime.timedelta(days=1)]:
    s,e=get(f"{API}/instruments/STOCK/86627/simple_chart_history?chartType=PRICE&endDate={today}&idNotation={n}&interval=D1&startDate={st}")
    print("D1",st,s, len(e.get("tick",[])) if s==200 else e, e.get("datetimeTick",[])[:2] if s==200 else "")
s,e=get(f"{API}/instruments/STOCK/86627/simple_chart_history?chartType=PRICE&endDate={today}&idNotation={n}&interval=W1&startDate={today-datetime.timedelta(days=7)}")
print("W1",s,len(e.get("tick",[])) if s==200 else e)
for path in ["instruments/FUND/25096683/snapshot","instruments/STOCK/86627/snapshot","derivatives/ISIN:DE000A0S9GB0/snapshot","instruments/DERIVATIVE/18869269/snapshot","instruments/CRYPTO/BTCEUR/snapshot","instruments/CRYPTO/BTCUSD/snapshot"]:
    s,e=get(f"{API}/{path}")
    if s==200:
        ql=e.get("quoteList",{}).get("list",[])
        print("SNAP",path,s,[(x["market"].get("codeMarket"),x["market"].get("idNotation"),x.get("isoCurrency")) for x in ql][:8], "quote:", (e.get("quote") or {}).get("market",{}).get("codeMarket"), (e.get("quote") or {}).get("isoCurrency"))
    else: print("SNAP",path,s,e)
for qv in ["Bitcoin Euro","BTCEUR","Ethereum","Solana","XRP"]:
    s,e=get(f"{API}/instruments/query?searchValue={urllib.parse.quote(qv)}&limit=4")
    print("CQ",qv,[(x.get("entityType"),x.get("entityValue"),x.get("name")) for x in e.get("list",[])][:4])
cat=json.load(open("catalog.json"))
for c in cat:
    if c["type"]=="krypto": continue
    sv=c.get("isin") or c["name"].replace(" (ADR)","").replace(" Vz.","")
    s,e=get(f"{API}/instruments/query?searchValue={urllib.parse.quote(sv)}&limit=3")
    lst=e.get("list",[]) if s==200 else []
    print("CAT",c["id"],"|",sv,"=>",[(x.get("entityType"),x.get("isin"),x.get("name"),x.get("symbol")) for x in lst][:3])
    time.sleep(0.2)
