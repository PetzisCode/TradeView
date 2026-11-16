import json, urllib.request, urllib.parse, re
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
def get(u, acc="*/*"):
    try:
        with urllib.request.urlopen(urllib.request.Request(u,headers={"User-Agent":UA,"Accept":acc,"Accept-Language":"de-DE"}),timeout=20) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code, e.read()[:300]
    except Exception as e: return 0, str(e).encode()
def show(u,n=900):
    s,b=get(u); print("===",u,"->",s,len(b)); print(b[:n].decode('utf8','replace').replace('\n',' ')); return s,b
show("https://www.bing.com/news/search?q=SAP+Aktie&format=rss&setlang=de-DE&cc=DE",1500)
for u in ["https://api.onvista.de/api/v1/news/list?instrumentEntityValue=86627&instrumentEntityType=STOCK&limit=5",
          "https://api.onvista.de/api/v1/instruments/STOCK/86627/news?limit=5",
          "https://api.onvista.de/api/v1/news/instruments/STOCK/86627?limit=5",
          "https://api.onvista.de/api/v1/stocks/ISIN:US0378331005/news?limit=5",
          "https://api.onvista.de/api/v1/news/latest?limit=3",
          "https://www.finanzen.net/rss/news",
          "https://www.finanznachrichten.de/rss-aktien-nachrichten",
          "https://news.google.com/rss/search?q=SAP+Aktie&hl=de&gl=DE&ceid=DE:de"]:
    show(u,700)
