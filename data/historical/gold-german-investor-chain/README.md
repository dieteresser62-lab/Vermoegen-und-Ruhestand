# Gold in deutscher Anlegerwährung

Die festgeschriebenen primären Eingaben liefern das erzeugte Artefakt
`GoldGermanInvestorChainV1`.

## Quelldateien

| Datei | Reihe / Verwendung | SHA-256 |
| --- | --- | --- |
| `../global-equity-research-chain/originals/JSTdatasetR6.xlsx` | JST R6 `DEU.xrusd`, deutsche Währung je USD zum Jahresende für den Proxy vor der Frankfurter Reihe | `c1bb91fe56ea50d4f27af5c0fc897d481e89ae38ce41eaecab62134c9354981d` |
| `originals/bundesbank-frankfurt-gold-annual-1968-1998.csv` | Bundesbank `BBEX3.A.XAU.DEM.EA.AC.C03`, Jahresdurchschnitt des Frankfurter Fixings in DEM je Kilogramm | `c08654b065a5685456bf2ebd954b43fec3cef9a9755f121d9dab6420c9410e2e` |
| `originals/bundesbank-usd-eur-annual-1999-2025.csv` | Bundesbank `BBEX3.A.USD.EUR.BB.AC.A04`, Jahresdurchschnitt USD je EUR | `ba8810d1b754e63f26e84824dcf0dd2f24716c51e9ba385bb09002b2fc087a7e` |
| `originals/world-bank-cmo-historical-data-annual-2026-07.xlsx` | World Bank Pink Sheet, nominaler jährlicher Goldpreis in USD je Feinunze | `d418b3c12f1e374a77113d8d42aeb3ffe8c154e7156e28c7b289e7adccf36af0` |

Die Rohdateien bleiben unverändert. Der Generator bricht ab, wenn Hash,
Abdeckung oder Reihenkennung abweichen oder wenn Werte fehlen oder nicht
endlich sind.

## Rekonstruktion

```text
npm run build:gold-german-investor-data
npm run verify:gold-german-investor-data
```

Der Generator konstruiert nominale Renditen mit unterschiedlichen
Beobachtungszeitpunkten je Segment:

- `1925-1932`: gesetzlicher USD-Goldpreisanker zum Jahresende, multipliziert
  mit dem JST-Jahresendkurs der deutschen Währung je USD;
- `1933`: von der Federal Reserve Bank of New York gemeldeter letzter
  RFC-Ankaufspreis von USD 34.06, festgesetzt am 18. Dezember, multipliziert
  mit dem JST-Jahresendwechselkurs;
- `1934-1944`: gesetzlicher Jahresendanker von USD 35, multipliziert mit dem
  JST-Jahresendkurs der deutschen Währung je USD;
- `1945-1950`: ausdrücklich gekennzeichnete Nullrenditebrücke über Nachkriegszeit
  und Währungsbruch;
- `1951-1967`: USD-Goldpreisanker zum Jahresende, multipliziert mit dem
  JST-Jahresendkurs DEM je USD;
- `1968-1998`: Jahresdurchschnittsstände des Frankfurter Goldfixings der Bundesbank;
- `1999-2025`: jährlicher World-Bank-Durchschnitt des USD-Goldpreises, geteilt
  durch den jährlichen Bundesbank/EZB-Durchschnittskurs USD je EUR.

Die Beobachtung für 1933 ist im
[Federal Reserve Bank of New York 1933 Annual Report](https://fraser.stlouisfed.org/title/annual-report-federal-reserve-bank-new-york-467/nineteenth-annual-report-federal-reserve-bank-new-york-year-ended-december-31-1933-17978/fulltext)
belegt. Der Übergang 1968 vergleicht den Frankfurter Teiljahresdurchschnitt
ab 18. Juni mit dem Paritäts-/Wechselkursanker für 1967. Der Übergang 1999
rechnet den Bundesbank-Indexstand von 1998 mit dem unwiderruflichen Kurs
`1.95583 DEM/EUR` und `32.15074656862798` Feinunzen je Kilogramm um.

Das frühe Paritäts-/Wechselkurssegment ist ein historischer Forschungsproxy.
Es belegt keinen durchgehend zugänglichen deutschen Privatkundenmarkt für
Gold. Die Brücke 1945-1950 ist eine sichtbare Modellannahme und weder eine
beobachtete Rendite noch ein stiller Nullersatz für fehlende Daten. Sie hält
den nominalen Goldwert konstant; bei positiver Inflation ist die reale
Rendite daher negativ. JST-Beobachtungen für 1946-1949 bleiben nur als
ausdrücklich ausgeschlossene Quellenbeobachtungen erhalten, weil Reichsmark-
und Nachreformwerte keine durchgehende investierbare Bezugswährung bilden.
Der gesamte bisherige Monte-Carlo-Pool zieht weiterhin aus Proxyjahren und
der Brücke. Das kann die modellierte Goldvolatilität unterschätzen und
belegt keine wiederholbaren Marktrenditen.
