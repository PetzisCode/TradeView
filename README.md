# TradeView

Persönliche Depot-Übersicht als Web-App fürs iPhone – für Aktien, ETFs und Krypto, die es bei Trade Republic gibt.

**App öffnen:** https://petziscode.github.io/TradeView/
→ in Safari *Teilen* → *Zum Home-Bildschirm*

## Funktionen
- Heatmap: Kachelgröße = Anteil am Depot, Farbe = Entwicklung (1T, 1W, 1M, YTD, 1J, seit Kauf)
- Detailseite je Wertpapier: Kursverlauf (1T bis 10 Jahre), Kennzahlen, eigene Position mit Gewinn/Verlust, aktuelle Nachrichten
- Alle Kurse in Euro umgerechnet
- Dein Depot bleibt nur auf deinem Gerät (localStorage), Sicherung/Wiederherstellung unter „Mehr“

## So funktioniert's
Der Workflow `.github/workflows/update.yml` lädt an Börsentagen alle ~20 Minuten Kurse (Yahoo Finance)
und Nachrichten (Google News) für alle Werte aus `catalog.json` und veröffentlicht App + Daten im Branch `gh-pages`.

**Neues Wertpapier ergänzen:** Eintrag in `catalog.json` hinzufügen (`symbol` = Yahoo-Finance-Kürzel, z. B. `SAP.DE`, `AAPL`, `EUNL.DE`).

Keine Anlageberatung, alle Angaben ohne Gewähr.
