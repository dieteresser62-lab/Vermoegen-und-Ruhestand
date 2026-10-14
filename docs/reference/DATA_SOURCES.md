# Datenquellen und Herkunft

## Optionale Live-Daten

Die App bleibt ohne Internet nutzbar. Scheitert ein Live-Abruf, verwendet sie
vorhandene lokale Werte, zeigt eine Warnung oder sperrt die Kursaktualisierung.
Für einen bereits bestätigten atomaren Jahresabschluss gelten strengere
Anforderungen: Fehlt ein Pflichtwert, ist er veraltet oder gehört er zu einer
anderen Periode, bricht der Jahresschritt ab. Der Koordinator
bleibt im vorgesehenen Wiederherstellungspfad.

| Quelle | Endpunkt / Pfad | Verwendung | Laufzeitpfad |
| --- | --- | --- | --- |
| Yahoo Finance | Lokaler Proxy `http://127.0.0.1:8787` / `http://localhost:8787` | ETF- und Kursaktualisierungen, etwa für `VWCE.DE` | Browser: Node-Proxy, gestartet durch `scripts/serve.mjs` (`start_suite.cmd`, `npm run serve`); Tauri: integrierter Rust-Proxy in `src-tauri/src/lib.rs` |
| ECB Data API | `https://data-api.ecb.europa.eu/service/data/HICP/A.DE.N.000000.4D0.AVR` | Deutscher HICP-Gesamtindex, Veränderungsrate des Jahresdurchschnitts | Direkter Abruf aus Browser/Tauri-WebView |
| World Bank API | `https://api.worldbank.org/v2/country/DEU/indicator/FP.CPI.TOTL.ZG` | Deutsche CPI-Inflation, jährliche Prozentänderung | Direkter Abruf aus Browser/Tauri-WebView |
| OECD Data Explorer API | `https://sdmx.oecd.org/public/rest/data/OECD.SDD.TPS,DSD_PRICES@DF_PRICES_ALL,1.0/DEU.A.N.CPI.PA._T.N.GY` | Deutscher nationaler CPI-Gesamtindex, jährliche Wachstumsrate | Direkter Abruf aus Browser/Tauri-WebView |
| Yale/CAPE mirror access | `https://r.jina.ai` | CAPE-Ersatzabrufe | Direkter Abruf aus Browser/Tauri-WebView |
| Google Fonts | `https://fonts.googleapis.com`, `https://fonts.gstatic.com` | Optionale Schriften der Oberfläche | Direkter Stylesheet-/Schriftabruf; lokale Ersatzschriften bleiben offline nutzbar |

Tauri-Release-Builds erlauben die Ziele für Yahoo, Inflation und CAPE in
`src-tauri/tauri.conf.json` unter `app.security.csp.connect-src`. Neue externe
Live-Quellen müssen dort ergänzt und im selben Änderungsschritt hier
dokumentiert werden. Für Schrifthosts gelten eigene CSP-Direktiven.

Yahoo-Anfragen enthalten das angefragte Symbol oder den Suchbegriff; bei
Kursverläufen außerdem Zeitraum und Intervall. Inflation und CAPE verwenden
feste Quellenkennungen und Zielperioden. Diese Pfade übertragen nicht gezielt
Depotmengen, Anschaffungskosten, Ausgabenbedarf oder Profilzustand. Externe
Anbieter erhalten dennoch die üblichen IP- und Transportmetadaten.
Google Fonts unterliegen `style-src` und `font-src`, nicht `connect-src`.

### Vertrag für Tranchenkurse

Personen & Vermögen akzeptiert automatische Kurse nur mit einem passenden
Symbol, einem positiven endlichen Preis, Währung `EUR`, UTC-Unix-Zeitstempel
und konsistenter Quelle. Kurse älter als sieben Kalendertage oder mehr als
fünf Minuten in der Zukunft werden abgewiesen. Fremdwährungen werden weder
als EUR behandelt noch automatisch umgerechnet.

Sammelaktualisierungen laufen jeweils nur einmal gleichzeitig, fragen jedes
Symbol einmal ab und begrenzen die Parallelität. Gültige Teilergebnisse werden
in einem bestätigten Commit gespeichert; fehlgeschlagene Tranchen behalten
ihren vorherigen Kurs. Scheitern alle Anfragen, bleibt der gespeicherte
Trancheninhalt unverändert. Browsertests führen deterministische EUR-,
Fremdwährungs- und Offline-Fixtures durch denselben lokalen Proxyvertrag.

## Vertrag für die Jahresinflation

Der Balance-Jahresablauf fragt das abgeschlossene Kalenderjahr aus dem
Jahresperiodenvertrag ab. Akzeptierte Quellenantworten werden auf die Metrik
`consumer_prices_all_items_annual_average_growth_pct` normiert und liefern:

- `rate`: endliche Prozentangabe im Live-Anbieterbereich der Balance von
  `-10` bis `50`. Historischer Engineinput und Balance-Import akzeptieren
  separat `-15` bis `50`, damit die Forschungsproxybeobachtung für 1932
  darstellbar bleibt, ohne die Plausibilitätsprüfung für Live-Daten zu lockern;
- `year`: genau das abgeschlossene Zieljahr;
- `source`: ausgewählter Anbieter und Indexfamilie;
- `dataAsOf`: Erstellungs- oder Aktualisierungszeit der Quellenantwort;
  die Abrufzeit dient nur als letzter Ersatz;
- `fetchStatus`: `ok_primary_ecb`, `ok_fallback_world_bank` oder `ok_fallback_oecd`;
- `metric`: die zuvor genannte normierte Metrikkennung.

Die Quellenfolge lautet ECB, World Bank, OECD. Jede Anfrage hat acht Sekunden
Zeitlimit und einen eigenen `AbortController`; der Timer wird bei Erfolg und
Fehler gelöscht. Antworten mit falschem Jahr oder falscher Reihe, mehrdeutige,
nicht endliche oder außerhalb des Bereichs liegende Beobachtungen werden
abgewiesen, bevor die nächste Quelle versucht wird. Scheitern alle Quellen,
bleiben Inflation und Bedarfseingaben unverändert. Außerhalb des
Jahreskoordinators endet der Vorgang ohne Schreibzugriff. Im bestätigten
Jahresabschluss verhindert der fehlgeschlagene Schritt den Abschluss;
der Snapshot vor der Mutation bleibt die Wiederherstellungsgrenze.

Inflation und Deflation verwenden dieselbe multiplikative Regel:
`next = previous * (1 + rate / 100)`. Negative Raten werden nicht auf null
begrenzt. Ein positiver Ausgangswert und der kumulierte Faktor müssen endlich
und größer als null bleiben. Optionale Bedarfsfelder, die bereits null sind,
bleiben null.

## Vertrag für die Jahresmarktdaten

Der ETF-Jahresschritt ist an die offene Periode des Koordinators gebunden.
Er verlangt die Phase `writes_started` und einen bestätigten
Wiederherstellungssnapshot. Angefragt wird `VWCE.DE` für das UTC-Fenster
vom 27. Dezember des abgeschlossenen Zieljahres bis ausschließlich 1. Januar
des Folgejahres. Akzeptiert wird der letzte gültige Schlusskurs vom
27.-31. Dezember genau dieses Zieljahres: ein endlicher EUR-Preis von
`0.50` bis `100000`.

`annualMarketDataMeta` speichert Schema, Preis, ISO-`asOf`, Ticker, Quelle,
Zieljahr, Perioden-ID und die ATH-Prüfung mit demselben Stichtag. Leere
Kursverläufe, falsche oder veraltete Jahre, unplausible Preise und Proxyfehler
blockieren den Schritt. Der Marktdatenschritt stellt seine vorherigen lokalen
Eingabe- und Metawerte wieder her. Der Jahreskoordinator verantwortet weiterhin
die weitergehende Wiederherstellung aus dem Snapshot.

### Vertrag für manuelle Markt-CSV

Manuelle Dateien sind lokale Nutzerquellen; der Import kontaktiert keinen
externen Anbieter. Er verlangt ausdrücklich den Modus `current` oder
`historical`, das Zielkalenderjahr, das erwartete ISO-`asOf`, das Instrument
und den Quelldateinamen. `current` muss zur Periode des aktiven Jahresvertrags
passen; außerhalb eines laufenden Commits gilt das letzte abgeschlossene
Kalenderjahr. `historical` ist nur für ein früheres Zieljahr gültig. Die
letzte CSV-Beobachtung muss Zieljahr und erwartetes `asOf` exakt treffen.

Der Parser verlangt eine Datums- und eine Schlusskursspalte sowie
Vergleichsbeobachtungen für die drei vorherigen Kalenderjahre. Als Herkunft
werden Quelldatei, Instrument, Importzeit, Beginn und Ende der Abdeckung,
abgedeckte Kalenderjahre, Zeilenanzahl und `highScope` gespeichert. Dieses
Vierjahresfenster kann nur `windowHigh` belegen, kein Allzeithoch. Deshalb
bleibt `verifiedAllTimeHighAvailable: false`.

Nach der vom Nutzer entschiedenen gerichteten D-13-Regel erhalten die
Enginefelder `ath` und `jahreSeitAth` das beobachtete Fensterhoch und dessen
Alter nur, wenn das Fensterhoch streng über dem letzten Schlusskurs liegt.
Der positive Abstand ist eine konservative Untergrenze des tatsächlichen
ATH-Rückgangs. Entspricht das Fensterhoch dem letzten Schlusskurs, bleiben die
ATH-Eingaben neutral. Die Anwendung ist mit `engineReference.policy =
"window_high_as_conservative_ath_lower_bound"` und `engineReference.applied`
gekennzeichnet; die Quellenangabe wird dadurch nicht zum belegten Allzeithoch.
Die Metadaten gehören zum Balance-Zustand, JSON-Export, zur Anzeige nach
Neuladen, Diagnose und Wiederherstellung beziehungsweise Rücknahme des Imports.

CAPE hat einen eigenen Herkunftsvertrag und erhält nicht das ETF-Jahresenddatum.
Die Abruffolge ist konfigurierte Primärquelle, Spiegelquelle, gespeicherter
Wert. `capeAsOf`, `capeSource`, `capeFetchStatus` und `capeUpdatedAt` trennen
Beobachtungsdatum, Anbieter und Abrufzustand. Ein gespeicherter oder veralteter
Ersatzwert bleibt entsprechend gekennzeichnet. Gibt es weder einen abgerufenen
noch einen gespeicherten Wert, scheitert der Schritt; im atomaren Jahresablauf
blockiert das den Commit.

## Deterministische Browsertests

`npm run test:browser` hängt nicht von den Live-Anbietern ab. Playwright fängt
die Anfragen des Jahresablaufs ab und liefert deterministische Fixtures für
ECB-Ersatzpfade, World Bank, Yahoo-Proxy, CAPE und Tranchenkurse. Alle anderen
externen Anfragen werden blockiert. Vorprüfung und einmaliger Jahrescommit,
Teilerfolge bei Tranchen sowie Offline-Verträge bleiben so offline reproduzierbar.

## Historische Marktdaten (`app/simulator/simulator-data.js`)

- Abdeckung: `1925-2025`
- Aktiensegmente mit Schätzungen oder Proxys: `1925-1950` und `2021-2025`
- Aktiensegment mit Anbieter-Backtest: `1951-2020`
- Inflationsproxy: `1925-1949`
- Amtliche Destatis-Inflationssegmente: `1950-1962`, `1963-1991`,
  `1992-2024` und `2025`
- Cash-/Geldmarktproxy: JST `1925-1944`, geschätzte Brücke `1945-1948`,
  Bundesbank-Tagesgeld/FIBOR `1949-1998`, EONIA `1999-2018`,
  EONIA/EURSTR-Übergang `2019`, EURSTR `2020-2025`
- Goldsegmente mit Proxys oder Ableitungen: Jahresendpreis nach staatlicher
  Vorgabe beziehungsweise amtlicher Preis mal JST-Jahresendwechselkurs
  `1925-1944`, ausdrücklich geschätzte Brücke `1945-1950`, staatlicher
  Jahresendpreis mal JST-Jahresendwechselkurs `1951-1967`, Frankfurter Fixing
  der Bundesbank `1968-1998`, World-Bank-Goldpreis geteilt durch
  Bundesbank-Kurs USD/EUR `1999-2025`
- Lohn-/Rentenfortschreibungsproxy: Veränderungen aufeinanderfolgender
  JST-R6-Indexstände `DEU.wage` für `1925-1946`; jährliche Destatis-Veränderung
  der durchschnittlichen Bruttomonatsverdienste ohne Sonderzahlungen
  `1947-2025`, getrennt an der Gebietsgrenze und den dokumentierten
  Methodenwechseln `1991`, `2007` und `2022`. Maschinenlesbare Übergänge
  markieren die Normierung am Beginn 1925, den Beobachtungsbruch der Kriegs-
  und Nachkriegszeit 1945 (`estimated`), den Quellenwechsel von JST zu
  Destatis 1947 und den Kontext der Währungsreform 1948.
- CAPE-Entscheidungssignal: konventionelles US-Shiller-Preis-CAPE aus Dezember
  `t-1`, gespeichert unter Renditejahr `t`, für `1925-2025`. Die
  Entscheidungsjahre `1925-1935` sind `estimated`, weil ihr Zehnjahresfenster
  Shillers interpolierte Cowles-Historie vor 1926 enthält.
- Maschinenlesbares Manifest: `HISTORICAL_DATA_MANIFEST`,
  Schema `HistoricalDataManifestV1`
- Datensatz-ID/Revision: `ruhestandsapp-historical-data-v1` / `2026-08-01.4`
- Kanonischer Inhaltshash:
  `c79350c5abf2dee2feeaae65c88ed5e58487f878cb598fdffc132fbf48d01e79`
- Hashverfahren: SHA-256 über kanonisches JSON (`sha256-canonical-json-v1`);
  Jahresschlüssel numerisch aufsteigend, Objektfelder lexikalisch sortiert,
  Zahlen als sprachunabhängige JSON-Tokens.
- Backtest-Rückblick: vier vollständige Jahre vor `startYear`. Daraus folgen
  die technischen Grenzen `1929-2025`. Die Backtest-Oberfläche liest sie aus
  dem aktiven Anbieter, setzt beide Jahreseingaben dynamisch und validiert
  gegen denselben Vertrag.

Der DOM-freie Vertrag liegt in `app/simulator/historical-backtest-contract.js`.
Er validiert den gesamten Datensatz einmal je Manifestrevision/Inhaltshash,
prüft die Reihenbrüche auf Reihenfolge, Eindeutigkeit und Grenzen und erzeugt
eine unveränderliche Nachschlagetabelle aus `HistoricalYearRecordV1`.
Je Einzelpfadanfrage oder Kohortenstapel erfolgt eine Periodenvorprüfung.
Der produktive historische Backtest und seine rollierenden Kohorten verwenden
diesen Anbieter. Die Datenpfade von Monte Carlo, Sweep, Optimierer und Workern
bleiben getrennt; sie gelten nicht als manifestgestützte Holdouts.

Das kanonische Aktienfeld heißt `global_equity_research_index`. Das erzeugte
Quellmodul liegt in `app/simulator/global-equity-research-chain.js`; das
gefilterte Original und die gefilterten Eingaben, Hashes, Namensnennungen und
die separate Datenlizenz unter `data/historical/global-equity-research-chain/`.
`npm run build:global-equity-data` erzeugt die Reihe neu. Sie ist ein
Forschungsproxy für 16 Länder und kein MSCI- oder anderer Anbieterindex.

Das kanonische Inflationsfeld heißt `inflation_de`. Das erzeugte Quellmodul
liegt in `app/simulator/german-cpi-chain.js`; festgeschriebene Originale,
Hashes, Namensnennungen und separate Datenlizenzen unter
`data/historical/german-cpi-chain/`. `npm run build:german-cpi-data` erzeugt
die Reihe neu; `npm run verify:german-cpi-data` prüft die Rekonstruktion
lesend. Die Reihe misst die Veränderung des deutschen nationalen
Verbraucherpreisindex im Jahresdurchschnitt und verwendet keinen HICP/HVPI.

Das JST-R6-Segment bis 1949 ist ein historischer Lebenshaltungskostenproxy,
kein moderner deutscher VPI. Auf 1938=126 normiert sind die Indexstände für
1925-1948 ganzzahlig; daraus folgt eine Auflösung der abgeleiteten Raten von
etwa 0.48-0.85 Prozentpunkten. Preiskontrollen und der Preisstopp während des
Krieges beeinflussen 1936-1948. Der nicht ganzzahlige JST-Endpunkt 1949 ist
ein ausdrücklicher Übergang nach der Währungsreform: Gewählt werden
`+7.0352%` gegenüber `-1.0526%` aus den Destatis-Indexständen `28.5 -> 28.2`,
eine Differenz von `8.0878` Prozentpunkten.

Der Preisproxy bildet die gesonderte Abwertung wesentlicher Reichsmark-Bar-,
Bank- und Sparguthaben nicht ab. Nach der Regelung vom Oktober 1948 wurden
100 RM zu 6.50 DM; das entspricht einem nominalen Bestandsverlust von 93.5%.
Die Preisänderung der Kette für 1936-1948 von etwa 58.5% ergibt dagegen einen
Kaufkraftverlust von etwa 36.9%. Die Reihe darf deshalb bei Geldvermögen
über die Reform hinweg nicht als Deflator einer durchgehenden Währung
dienen. Quelle:
[Deutsche Bundesbank, Währungsreform 1948](https://www.bundesbank.de/de/aufgaben/themen/waehrungsreform-1948-614040).

JST R6 liefert die Veränderungen deutscher CPI-Indexstände für den Proxy
1925-1949. Destatis liefert für 1950-1962 die amtliche Reihe der
Vierpersonenhaushalte mit mittlerem Einkommen im früheren Bundesgebiet,
für 1963-1991 die Reihe aller privaten Haushalte und für 1992-2025 den
deutschen VPI. Jede Rate eines Übergangsjahres wird innerhalb einer
Quellenreihe berechnet. Der Destatis-Wert für 1948 ist ein Durchschnitt des
zweiten Halbjahres und wird deshalb nicht zur Berechnung der Rate 1949
verwendet. Veröffentlichte Raten werden mit höchstens `0.05` Prozentpunkten
Abweichung gegen die gerundeten Jahresindexstände geprüft. Diese Grenze
akzeptiert die gemessene maximale echte Rundungsabweichung (`0.049688`
Prozentpunkte), weist aber jede Mutation einer veröffentlichten Rate um
plus/minus `0.1` Prozentpunkte in allen 76 amtlichen Gegenprüfungen für
1950-2025 ab.

Die lange Quellenreihe hat den Stand `2025-06`, die neueste Quellenkopie den
Stand `2026-07-10`. Die ausgewählten nationalen VPI-Jahresraten betragen
2024 und 2025 jeweils 2.2 Prozent. Der kombinierte Rohdatenhash lautet
`83841d2c11df3a5e193aa07db3bdfe815cbbeea7f9f81c3526b197702a46bdb4`;
der Hash der 101 erzeugten Raten lautet
`9ec87b5052d5e086517142c34213a4063e2be6ccdd8a5babf6d5722ffb76ae3a`.

Das kanonische Cash-Feld heißt `zinssatz_de`. Das erzeugte Quellmodul liegt
in `app/simulator/german-cash-money-market-chain.js`; das festgeschriebene
Bundesbank-PDF, die mechanisch extrahierten Tabellenseiten, Hashes,
Namensnennungen und Quellenbedingungen unter
`data/historical/german-cash-money-market-chain/`.
`npm run build:german-cash-money-market-data` erzeugt die Reihe neu;
`npm run verify:german-cash-money-market-data` prüft die Rekonstruktion lesend.
Build und Prüfung lesen das primäre PDF mit Poppler `pdftohtml` ab der
kompatiblen Mindestversion 25.07.0. Eine unabhängige koordinatenbasierte
Gegenprüfung der 77 Jahre muss exakt mit der Auswahl aus dem Layouttext
übereinstimmen. Das Programm wird über `RUHESTANDSAPP_PDFTOHTML`,
`RUHESTANDSAPP_POPPLER_BIN` oder `PATH` gefunden. Ein entwicklerspezifischer
Paketpfad oder eine bestimmte Patchversion gehört nicht zum Vertrag. Der
Layouttext ist ein abgeleitetes Artefakt und vom `rawDataHash` der
Primärquellen ausgeschlossen.

Die Kette verwendet JST R6 `DEU.stir` für 1925-1944 als uneinheitlichen Proxy
kurzfristiger Zinsen. Die fehlenden Beobachtungen für 1945-1948 werden
sichtbar mit dem letzten Wert von 1944, `2.13%`, fortgeschrieben. Sie gelten
als `estimated`, nicht als beobachtete investierbare Renditen. Ab 1949 nutzt
die Kette die erste Tagesgeldspalte in den langen Jahresdurchschnittstabellen
der Deutschen Bundesbank: gemeldete Frankfurter Tagesgeldsätze bis 1996,
FIBOR O/N für 1997-1998, EONIA für 1999-2018, den veröffentlichten
EONIA/EURSTR-Übergangsdurchschnitt für 2019 und EURSTR ab 2020. Negative
Jahresdurchschnitte behalten ihr Vorzeichen.

Das Segment 1949-1996 ist ein von der Bundesbank veröffentlichter Proxy,
kein amtlich festgesetzter oder notierter Satz. Es besteht aus ungewichteten
Monatsdurchschnitten der von Frankfurter Banken gemeldeten Sätze. Die
Quellenkette bis 1975 nennt auch
*Deutsches Geld- und Bankwesen in Zahlen 1876-1975* (Verlag Fritz Knapp)
und Berechnungen der Bundesbank. Der Wechsel
des Berichtskreises im März 1970 und der Zinstagekonvention von 360/360 auf
actual/360 im Juli 1990 sind ausdrücklich gekennzeichnete Brüche. Die
Jahresdurchschnitte 1970 und 1990 mischen deshalb Methoden.

Der veröffentlichte nominale Prozentsatz wird einmal als einfacher Proxy der
jährlichen Bruttorendite von Cash angewandt. Er ist keine
Fonds-Nettoinventarwertrendite und enthält weder zusätzliche Verzinsung noch
Produktkosten, Bankmarge, Kontogebühr oder Steuer. Im bestehenden
Simulatorvertrag heißt das Feld `cashBondReturn`; es gilt für operative
Liquidität, Geldmarktbestände, den liquiditätsnahen Gesundheitstopf und
Anleihetranchen. Für Anleihen ist es ein deklarierter Proxy mit unpassender
Laufzeit, ohne Duration, Laufzeitprämie, Kreditrisiko oder
Marktbewertungseffekte. Aktien und Gold verwenden ihn nicht.

Der fortgeschriebene Satz für 1948 bildet die gesonderte nominale Abwertung
wesentlicher Reichsmark-Bar-, Bank- und Sparguthaben im Verhältnis 100:6.5
nicht ab. Ein Lauf über die Reform hinweg ist deshalb kein durchgehender
realer Verlauf von Geldbeständen. Der Rohdatenhash allein der Primärquellen
lautet
`ea1608b5dee7e00ae7bf24bb651cb01cd3f0d5423b54cdf21b9f975cced30722`;
der Hash des abgeleiteten Extrakts lautet
`eae9ce9d4a172ecce6264fde18a618f810b4f11af2adb4bd53d1670fca44a97a`;
der Hash der 101 erzeugten Renditen lautet
`cf5471a345234984ac3ff8de57bffdb3128c1046e01ec998198721325ede9b69`.
Der Haftungsausschluss der ECB als EURSTR-Administrator ist in
`data/historical/german-cash-money-market-chain/LICENSE.md` referenziert.

Das kanonische Goldfeld heißt `gold_eur_perf`. Das erzeugte Quellmodul liegt
in `app/simulator/gold-german-investor-chain.js`; festgeschriebene Eingaben
aus JST, Bundesbank und World Bank, Quellenhashes, Namensnennungen,
Lizenzgrenzen und Methodennotizen unter
`data/historical/gold-german-investor-chain/`.
`npm run build:gold-german-investor-data` erzeugt die Reihe neu;
`npm run verify:gold-german-investor-data` prüft die Rekonstruktion lesend.

Die Kette misst nominale Goldpreisänderungen in der deklarierten deutschen
Anlegerwährung mit segmentspezifischen Zeitpunkten. Der frühe Proxy
multipliziert für 1925-1944 und 1951-1967 einen US-Jahresendgoldpreisanker
mit dem JST-R6-Jahresendkurs `DEU.xrusd`. Der Anker für 1933 ist der letzte
RFC-Ankaufspreis von USD 34.06, festgesetzt am 18. Dezember und gemeldet von
der Federal Reserve Bank of New York. Für 1934 gilt der gesetzliche Preis
von USD 35. Die Lücke 1945-1950 ist eine ausdrücklich geschätzte
Nullrenditebrücke über Nachkriegszeit und Währungsreform, keine beobachtete
investierbare Rendite.

Die Bundesbank-Reihe `BBEX3.A.XAU.DEM.EA.AC.C03` liefert das Frankfurter
Fixing in DEM je Kilogramm für 1968-1998. Der Übergang 1968 vergleicht den
Teiljahresdurchschnitt ab 18. Juni mit dem Preis-/Wechselkursanker 1967.
Ab 1999 werden jährliche World-Bank-Goldpreisstände in USD je Feinunze durch
die jährlichen USD-je-EUR-Stände der Bundesbank-Reihe
`BBEX3.A.USD.EUR.BB.AC.A04` geteilt. Der Übergang 1999 rechnet den
Frankfurter Stand von 1998 mit 1.95583 DEM/EUR und 32.15074656862798
Feinunzen je Kilogramm um.

Der Übergang 1968 mischt bewusst Zeitkonventionen: Ein Jahresendanker 1967
wird mit einem Teiljahresdurchschnitt ab 18. Juni verglichen. Ab 1969 werden
aufeinanderfolgende Frankfurter Jahresdurchschnitte verwendet. Der
US-Preisregimewechsel 1933/1934, die DEM-Aufwertung 1961, die Aussetzung der
Goldkonvertibilität des Dollars 1971, der Wechsel zu allgemein schwankenden
Wechselkursen 1973 und beide Quellenübergänge sind maschinenlesbare Brüche.

Zur Laufzeit wird jeder resultierende jährliche Bruttoprozentsatz genau einmal
angewandt. Produktaufschlag, Geld-/Briefspanne, Lagerung, Steuer und
Tracking-Kosten sind ausgeschlossen. Alle 101 Jahre sind endlich. Zwölf
wörtliche Nullwerte bleiben erhalten, jeder mit Erklärung: Für 1942-1944
und 1951-1953 müssen Preisanker und Wechselkurskomponente jeweils exakt
gleich sein; 1945-1950 bildet die sichtbare geschätzte Brücke. JST-Beobachtungen
für 1946-1949 werden separat als ausgeschlossene Eingaben ausgewiesen, weil
Reichsmark- und Nachreformwerte keine durchgehende investierbare
Bezugswährung bilden.

Die Brücke hält den nominalen Goldwert konstant und wirkt bei positiver
Inflation real negativ. Alle 101 Jahre gehen weiterhin in den bisherigen
Monte-Carlo-Pool ein. Proxyjahre und Brücke können die modellierte
Goldvolatilität unterschätzen; sie belegen keine wiederholbaren Marktrenditen.
Der Hash der primären Eingaben lautet
`133ed7c3d79a313de4a64f94e54b4f0e06e4f7b24ab4182aa5263958cae49b7d`;
der Hash der erzeugten Renditen lautet
`068a15a99c665b48dc14a187b654033d292c9de6ed3cf712f7e789ddcec049aa`.

Das kanonische Lohnfeld heißt `lohn_de`. Das erzeugte Modul liegt in
`app/simulator/german-gross-wage-growth-chain.js`; die festgeschriebene
JST-R6-Arbeitsmappe, Destatis-HTML, Hashes, Namensnennungen und Lizenzhinweise
unter `data/historical/german-gross-wage-growth-chain/`.
`npm run build:german-gross-wage-data` erzeugt die Reihe neu;
`npm run verify:german-gross-wage-data` prüft sie. Die Reihe misst die
jährliche Veränderung des Destatis-Index der durchschnittlichen
Bruttomonatsverdienste ohne Sonderzahlungen. Die veröffentlichte
Prozentänderung für Jahr `t` wird im Simulationsjahr `t` einmal angewandt,
wenn `rentAdjMode=wage` gilt.

Die Jahre 1925-1946 verwenden unabhängig aus aufeinanderfolgenden nominalen
JST-R6-Lohnindexständen `DEU.wage` abgeleitete Veränderungen und bleiben
Forschungsproxy. Destatis deckt 1947-1990 für das frühere Bundesgebiet und
1991-2025 für das wiedervereinigte Deutschland ab. Die veröffentlichte
Änderung der Abdeckung 2007 und der Wechsel zur Verdiensterhebung 2022 teilen
das amtliche Segment. Die niedrigen, auf eine Dezimalstelle gerundeten
Indexstände 1947-1955 reichen von 1.9 bis 4.5. Die Veränderung für 1947
verwendet außerdem den Indexstand 1.8 aus 1946. Daraus folgt ein
dokumentierter maximaler relativer Präzisionseinfluss von etwa 2.8 Prozent
durch die halbe Einheit der letzten Indexdezimalstelle.

Der Vertrag für Reihenbrüche markiert 1925 als Normierung am Reihenbeginn,
1945 als geschätzte Kriegs- und Nachkriegsbrücke ohne Marktlohnbeobachtung,
1947 als Quellenwechsel von JST zu Destatis und 1948 als Kontext der
Währungsreform. Der Wert 1946 bleibt die letzte Veränderung aus dem
JST-Forschungsproxy vor diesem Quellenwechsel.

Der beibehaltene, aus Indexständen abgeleitete Wert für 1945 lautet
`+22.687439%`. Er hält die Konstruktion aus den festgeschriebenen
JST-Indexveränderungen bis 1946 intern konsistent, statt eine undokumentierte
einmalige Brücke einzusetzen. Das ist eine Modellentscheidung zur Kontinuität
und kein Beleg für einen beobachtbaren Marktlohn im Krieg. Der
maschinenlesbare Vertrag stuft den Wert deshalb als `estimated` ein,
erfasst eine neutrale 0-Prozent-Brücke als verbindliche Sensitivitätsreferenz
und weist die volle einjährige Differenz der Rentenfortschreibung von
`22.687439` Prozentpunkten aus. Der lohnindexierte Referenzfall 1944-1950
überschreitet den Übergang 1946/1947 und hält fest, dass die veröffentlichte
Veränderung 1947 direkt verwendet wird, ohne Quotient aus Indexständen
verschiedener Quellen.

Zur Laufzeit dient die Reihe weiterhin als allgemeiner Proxy der
Rentenfortschreibung. Sie bildet nicht die historische gesetzliche
Rentenanpassung in Deutschland ab. Der kombinierte Hash der primären Eingaben
lautet
`cfd5c598a8bc846a96966fa8ff7388d80c30f3ada39edbfe90d39f234eef9d9b`;
der Hash der 101 erzeugten Werte lautet
`e10e581f6994e07ed0a943b3716dd8fd5dea7b8b272d47a546466af8701a3057`.

Das kanonische CAPE-Feld heißt `cape`. Das erzeugte Modul liegt in
`app/simulator/us-shiller-cape-chain.js`; die festgeschriebene Arbeitsmappe
des Herausgebers und die Nutzungsgrenze unter
`data/historical/us-shiller-cape-chain/`. `npm run build:us-shiller-cape-data`
erzeugt die Reihe neu; `npm run verify:us-shiller-cape-data` prüft sie.
Gewählt wird das konventionelle preisbasierte CAPE von Robert J. Shiller für
den US-Aktienmarkt, kein Total-Return-CAPE und keine globale oder deutsche
Bewertungskennzahl.

Für das Renditejahr `t` wählt der Generator Dezember `t-1`, speichert das
Signal unter `t` und exportiert Beobachtungsjahr/-monat, Datenstandsjahr und
Entscheidungsjahr getrennt. Zur Laufzeit wird der erzeugte Wert einmal
verwendet; eine zweite Vorjahresabfrage ist untersagt. Die Entscheidungsjahre
1925-1935 gelten als `estimated`, weil ihre zurückliegenden
CAPE-Zehnjahresfenster noch das interpolierte Cowles-Segment vor 1926 enthalten.
1936-2025 gilt als `backtested`. Der Monte-Carlo-Filter für geschätzte
Historie beginnt bei 1951 und schließt damit bei Aktivierung alle betroffenen
CAPE-Datenstände aus.

Der Hash der Roharbeitsmappe lautet
`0e3d716f83f51c14f40c5ab5662e767cde4f83fcb7305db24ab003df2c9ee6c5`;
der Hash der 101 erzeugten Signale lautet
`d1101958fed64dadf8fba76e9e4e92c8d24e86bd3d21accc42cdb60c247a835f`.
Für den öffentlichen Download des Herausgebers wurde keine ausdrückliche
offene Weiterverbreitungslizenz gefunden. Der Haftungsausschluss des
Herausgebers beziehungsweise von Yale und diese Einschränkung bleiben
festgehalten.

## Demografie-, Pflege- und Hinterbliebenenvertrag

Die erzeugte, bis in alle Unterobjekte eingefrorene Datei
`app/simulator/german-demography-care-survivor-contract.js` wird aus den
festgeschriebenen Originalen unter
`data/static/german-demography-care-survivor-contract/` rekonstruiert.
`npm run build:german-demography-data` erzeugt sie neu;
`npm run verify:german-demography-data` prüft die bytegleiche Rekonstruktion
lesend.

Die Sterblichkeit verwendet den Destatis-Bericht
*Statistischer Bericht Sterbetafeln 2023/2025* (EVAS 12621),
Tabellen `12613-b01` und `12613-b02`,
für Deutschland. Das ist der genaue maschinenlesbare Quellenname und nicht
die separat veröffentlichte `Allgemeine Sterbetafel`. Für das zur Laufzeit
erreichte Alter von 18-100 werden die amtlichen jährlichen
Sterbewahrscheinlichkeiten `qx` von Männern und Frauen verwendet. Dies ist
eine Periodenbeobachtung, keine Kohortenprognose; eine künftige Verbesserung
der Sterblichkeit wird nicht ergänzt.

Die amtliche Quelle endet bei Alter 100. Für 101-110 bleibt deshalb die
bisherige Simulatorfortsetzung als ausdrückliche `model_assumption` erhalten;
Alter 110 ist mit Wahrscheinlichkeit 1 terminal. Die Laufzeittabelle für
`divers` ist der ungewichtete Mittelwert männlicher und weiblicher `qx`,
keine amtliche dritte Destatis-Geschlechtstabelle. Der SHA-256 der
Sterblichkeitsquelle lautet
`fbc46083d581e5978c679600875164bcc5af0565a9eb33c57bf33d44ca87aadc`;
der Hash der vollständigen Laufzeittabelle lautet
`88c1000eac950016a65e7408127d5c1256683946933b710a0c28f672fde5f232`.

Die Pflege-Referenzdaten stammen aus der Destatis-Pflegestatistik zum
31. Dezember 2023. Der Vertrag hält beobachtete Bestandszahlen,
Pflegegradanteile und Prävalenzen nach Alter und Geschlecht ausschließlich
als Kontextbelege fest; gegen diese Beobachtungen wird zur Laufzeit nicht
validiert. Eine Prävalenz ist ein Bestandsverhältnis am Stichtag. Sie wird
weder durch eine angenommene Dauer geteilt noch anderweitig als individuelle
jährliche Eintritts- oder Fortschrittswahrscheinlichkeit verwendet.

Die Laufzeit-Eintrittswahrscheinlichkeiten für die Anfangspflegegrade 1 und 2
und die Wahrscheinlichkeiten für das Fortschreiten um einen Grad sind eigene
`model_assumption`-Objekte. Chronische Pflege dauert bis zum simulierten Tod;
akute Pflege zieht eine Dauer aus dem Nutzerbereich mit den UI-Vorgaben
5-10 Jahre. Der SHA-256 der Pflegequelle lautet
`a8088d8e95964c5ffade848b9f303d000dc499519512f66f92ee6b8d60aa4280`;
der Hash der beobachteten Referenzdaten lautet
`c9b55d32c1d084ba948e2b77bddb7392c918bce14ec11c908ab38afde8c9a48a`.

Der Hinterbliebenenvertrag verwendet die Seite der Deutschen Rentenversicherung
[Renten an Hinterbliebene](https://www.deutsche-rentenversicherung.de/DRV/DE/Rente/Allgemeine-Informationen/Rentenarten-und-Leistungen/Renten-an-Hinterbliebene/renten-an-hinterbliebene_node.html)
als Orientierung für 55 Prozent. Zur Laufzeit bleibt es ein vom Nutzer
gesteuerter Szenariozahlungsstrom mit Prozentsatz oder Stopp, Heiratsversatz
und Mindest-Ehedauer. Gesetzliche Anspruchsberechtigung, kleine oder große
Witwen-/Witwerrente, Einkommensanrechnung, Ausnahmen für Kinder, Behinderung,
Alter oder altes Recht, Sterbevierteljahr und Abfindung bei Wiederheirat
werden nicht berechnet. Die UI-Vorgabe lautet `percent`/55; die Angabe
`defaultMode=stop` entspricht ihr nicht.

Beide Destatis-Arbeitsmappen verwenden Data Licence Germany – attribution – Version 2.0.
Alle Datenverträge bleiben bis zur externen Prüfung `not_validated`.
Die Hashes belegen Rekonstruktion und Identität, keine fachliche Eignung.

Die offene Laufzeitmessung `post-backtest-data-07-v1` vergleicht den
unveränderlichen Basiscommit mit dem Kandidaten bei gleicher Node-Laufzeit,
gleichem festem Seed, Profil und gleichen Jahresdaten. Sie umfasst 2048
Monte-Carlo-Läufe über 40 Jahre und zwei Sweep-Kombinationen mit Pflege,
beiden Personen und aktivem Hinterbliebenenzahlungsstrom von 55 Prozent.
Die Fixture speichert 40 numerische Differenzen und deren Hashes. Sie isolieren
den Austausch der Sterblichkeitstabelle. Pflege- und Hinterbliebenenpfade
zeigen nachgelagerte Auswirkungen auf Dauer und Zahlungsströme; ihre
Parameter und Formeln bleiben im gemessenen Vergleich gleich. Die Messung
hat den Status `pending` und gilt nicht als externe Validierung.

### Statusbegriffe im Manifest

- Auflösungsfelder (`variant`, `currency`, `region`, `frequency`, `source`,
  `license`, `transformation`) verwenden `known`, `unresolved` oder
  `not_applicable`. Ein `known`-Wert darf nicht leer sein. `unresolved`
  enthält nie einen geratenen Wert.
- Die Datensatzqualität verwendet `present`, `estimated`, `unresolved`,
  `fallback_zero` oder `missing`.
- `missing` und nicht endliche Pflichtwerte sind Vertragsfehler.
- `fallback_zero` ist nur in Reihensegmenten gültig, die ausdrücklich in
  `missingness.fallbackZeroSegments` stehen. Keine aktuelle Reihe deklariert
  ein solches Segment.
- Jeder Nullwert in `gold_eur_perf` hat eine maschinenlesbare Erklärung aus
  Quellenableitung oder Schätzung. Null dient nie als stiller Ersatz für
  fehlende Daten.

### Reihenmanifest

| Reihen-ID | Variante | Währung | Region | Frequenz | Quelle | Lizenz | Transformation | Geschätztes Segment | Fehlende Werte |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `global_equity_research_index` | wirtschaftlich gewichteter Forschungsproxy der Gesamtrendite | USD-Proxy 1925-1950; deutsche Anlegerwährung 1951-2020; EUR 2021-2025 | 16 fortgeschrittene Volkswirtschaften | jährlich | JST R6; OECD `DSD_STES@DF_FINMARK` 4.0; ECB `EXR` | abgeleitete Daten `CC BY-NC-SA 4.0`; OECD/ESCB-Bedingungen gelten zusätzlich | erzeugte wirtschaftliche Vorjahresgewichte; USD bis 1950; deutsche Anlegerwährung ab 1951; dokumentierte Kurs-/Dividendenumrechnungen | 1925-1950 und 2021-2025 | Pflichtfeld; fehlende/nicht endliche Werte und nicht positive Indexstände abweisen |
| `inflation_de` | segmentierte deutsche nationale Verbraucherpreiskette; ohne HICP/HVPI | nicht anwendbar | DE | jährlich | JST R6 1925-1949; lange Destatis-Reihe 1950-2024; aktuelle Destatis-Jahrestabelle 2025 | JST-abgeleitetes Segment `CC BY-NC-SA 4.0`; Destatis-Segmente Data Licence Germany - attribution - 2.0 | Veränderungen aufeinanderfolgender JST-Indexstände bis 1949; veröffentlichte Destatis-Jahresdurchschnittsänderungen ab 1950 mit quelleninternen Übergängen; ohne die gesonderte nominale Abwertung von Geldbeständen im Verhältnis 100:6.5 bei der Reform 1948 | 1925-1949 | Pflichtfeld; fehlende/nicht endliche Werte abweisen |
| `zinssatz_de` | segmentierter nominaler Jahresdurchschnittsproxy kurzfristiger/Tagesgeld-Bruttorenditen für `cashBondReturn` | historische deutsche Währungsregime/DEM bis 1998; EUR ab 1999; Prozentsätze rechnen keine Bestände um, die Abwertung 1948 wird nicht umgesetzt | DE | jährlich | JST R6 `DEU.stir` 1925-1944; ausdrückliche Fortschreibung 1945-1948; Bundesbank-veröffentlichter Frankfurter Proxy/FIBOR/EONIA/EURSTR 1949-2025; Fritz-Knapp/Bundesbank-Quellenkette bis 1975 | JST-abgeleitetes Segment `CC BY-NC-SA 4.0`; Bundesbank/ESCB-Bedingungen und ECB-EURSTR-Haftungsausschluss | veröffentlichte Jahresdurchschnitte einmal im gemeinsamen Cash-/Anleihepfad; ohne Anleihelaufzeiteffekte, zusätzliche Verzinsung, Kosten, Marge und Steuer | 1925-1948 | Pflichtfeld; fehlende/nicht endliche Werte abweisen |
| `lohn_de` | segmentierter Proxy des nominalen Lohnwachstums; Destatis-Durchschnittsbruttomonatsverdienste ohne Sonderzahlungen ab 1947 | nicht anwendbar | JST-DEU-Proxy bis 1946; früheres Bundesgebiet bis 1990; danach wiedervereinigtes Deutschland | jährlich | JST R6 `DEU.wage` 1925-1946; Destatis-Jahrestabelle 1947-2025 | JST-abgeleitetes Segment `CC BY-NC-SA 4.0`; Destatis Data Licence Germany - attribution - 2.0 | aufeinanderfolgende JST-Indexveränderungen, danach veröffentlichte Destatis-Veränderungen für Jahr `t`; einmal bei `rentAdjMode=wage` angewandt; ausdrückliche Übergänge 1925/1945/1947/1948; keine gesetzliche Rentenanpassung | 1925-1944 und 1946 Proxy; 1945 geschätzt | Pflichtfeld; fehlende/nicht endliche Werte abweisen |
| `gold_eur_perf` | nominaler Goldpreisrenditeproxy in deutscher Anlegerwährung mit Zeitkonventionen je Segment | historische deutsche Währung/DEM bis 1998; EUR ab 1999 | globaler Goldpreis mit deutscher Anlegerbezugswährung | jährlich | gesetzliche Jahresendpreise der Federal Reserve/RFC-Jahresendpreis 1933 und JST-R6-Jahresendwechselkurse 1925-1967; Frankfurter Fixing der Bundesbank 1968-1998; World Bank Gold und Bundesbank USD/EUR 1999-2025 | JST-abgeleitete Eingabe `CC BY-NC-SA 4.0`; World Bank `CC BY 4.0`; Bundesbank/ESCB-Bedingungen | staatlicher/amtlicher Jahresendgoldpreis mal deutscher Jahresendwechselkurs; ausdrückliche Brücke 1945-1950; Veränderungen Frankfurter Jahresdurchschnittsstände; World-Bank-USD-Goldjahresdurchschnitt geteilt durch USD/EUR-Jahresdurchschnitt mit dokumentierten Übergängen 1968/1999 | 1945-1950 | Pflichtfeld; fehlende/nicht endliche Werte und nicht klassifizierte Nullen abweisen; jeder wörtliche Nullwert muss aus Komponenten belegt oder ausdrücklich geschätzt sein |
| `cape` | konventionelles US-Shiller-Preis-CAPE; ohne Total-Return-CAPE | nicht anwendbar | US-Aktienmarkt | jährliches Entscheidungssignal | Arbeitsmappe Shiller U.S. Stock Markets 1871-Present, konventionelle CAPE-Spalte | öffentlicher Herausgeberdownload; keine ausdrückliche offene Weiterverbreitungslizenz gefunden; Haftungsausschluss gilt | Dezember `t-1` unter Entscheidungs-/Renditejahr `t` gespeichert und einmal verwendet | 1925-1935 | Pflichtfeld; fehlende/nicht endliche Werte und nicht positive Kennzahlen abweisen |

Für alle sechs historischen Reihen sind Quellenidentität, Transformation und
Lizenz- beziehungsweise Nutzungsgrenzen geklärt. Das bedeutet keine externe
Validierung der Forschungs- oder Proxyketten.

### Simulationsweite Dateninventur

`app/simulator/simulation-data-inventory.js` ergänzt die unveränderliche
`SimulationDataInventoryV1`, Revision `2026-08-01.4`. Der vorhandene
`HistoricalDataManifestV1` bleibt der aktive Laufzeit-/Backtest-Datensatzvertrag.
Die weitergehende Inventur prüft Belege und Änderungen dieses Vertrags sowie
der produktiv verwendeten statischen Modelldatenklassen.

Jeder Inventureintrag enthält:

- interne ID, Kategorie, Einheit und Implementierungsorte;
- Quelle, externe Reihenkennung, Währung, Jahreskonvention, Transformation,
  Lizenz und Abrufdatum als Auflösungsfelder;
- ein Auflösungsfeld `rawDataHash` und einen separaten kanonischen
  `embeddedValueHash` des aktuellen App-Werts, sofern dieser vorhanden ist;
- Evidenzklasse und einen eigenen Status der externen Validierung.

Auflösungsfelder verwenden `known`, `unresolved` oder `not_applicable`.
Ein `unresolved`-Feld enthält immer `value: null`; ein geratenes Etikett ist
ungültig. Die Evidenzbegriffe `official`, `derived`, `backtested`, `proxy`,
`estimated`, `model_assumption`, `user_input`, `stress_parameter`, `missing`
und `unresolved` bleiben getrennt. Ein passender Hash des eingebetteten Werts
belegt nur technische Reproduktion, nicht die externe Identität, Richtigkeit
oder das Nutzungsrecht des Werts.

Die sechs historischen Einträge haben eigene lückenlose `qualitySegments`
für 1925-2025:

| Reihe | Aktueller Segmentvertrag | Maßgebliche Prüfgrenze |
| --- | --- | --- |
| `global_equity_research_index` | 1925-1950 `proxy`; 1951-2020 `backtested`; 2021-2025 `estimated` | Quellenkette reproduzierbar; 1950 bleibt in USD, damit der rekonstruierte deutsche Faktor 1949/1950 nicht als globale Rendite wirkt; das moderne Modell mit festgehaltenen Dividenden bleibt eine ausdrückliche Grenze. Die lokale deutsche Komponente enthält weiterhin eine dokumentierte Währungsreformrekonstruktion 1948/1949: Deutschland trägt 1948 etwa -4.17 und 1949 etwa +37.38 Prozentpunkte bei, trotz eines wirtschaftlichen Gewichts nahe fünf Prozent. Dieses schwach belegte Proxyartefakt bleibt erhalten, gilt nicht als Marktereignis und entfällt bei Ausschluss geschätzter Historie. |
| `inflation_de` | 1925-1949 `proxy`; 1950-1962 `official` mit `proxy_population`; 1963-1991 `official`; 1992-2024 `official`; 2025 `official` | festgeschriebene JST-/Destatis-Originale und erzeugte Hashes klären die nationale VPI-Kette; Gebiets- und Bevölkerungsübergänge bleiben sichtbar, HICP/HVPI ist ausgeschlossen |
| `zinssatz_de` | 1925-1944 `proxy`; 1945-1948 `estimated`; 1949-1996 Frankfurter Tagesgeld `proxy`; 1997-1998 FIBOR O/N `official`; 1999-2018 EONIA `official`; 2019 Übergang `official`; 2020-2025 EURSTR `official` | primäres PDF und abgeleiteter Layoutpfad stimmen exakt überein; Methodenwechsel 1970/1990, Geldbestandsbruch 1948 und EURSTR-Haftungsausschluss bleiben sichtbar; die gemeinsame Anleiheanwendung bleibt ein Bruttomodellproxy mit unpassender Laufzeit |
| `lohn_de` | 1925 `proxy`; 1926-1944 `proxy`; 1945 `estimated`; 1946 `proxy`; 1947-1955, 1956-1990, 1991-2006, 2007-2021 und 2022-2025 `official` | JST- und Destatis-Quellenidentitäten geklärt; Brüche 1925/1945/1947/1948 bewahren Reihenbeginn, fehlende Kriegs-/Nachkriegs-Marktbeobachtung, Quellenwechsel und Währungsreformkontext; die Rentenfortschreibung nutzt ausdrücklich einen eingeordneten Bruttoverdienstproxy, keine gesetzliche Rentenanpassung |
| `gold_eur_perf` | 1925-1944 `proxy`; 1945-1950 `estimated`; 1951-1967 `proxy`; 1968, 1969-1998, 1999 und 2000-2025 separat `derived` | Quellenhashes und Übergänge reproduzierbar; zwölf quellenabgeleitete oder ausdrücklich geschätzte Nullen erklärt; früher Marktzugang, Nachkriegsbrücke und Grenzen von Jahresdurchschnitten/Produktkosten erlauben keine Aussage über ein investierbares Produkt oder eine externe Validierung |
| `cape` | 1925-2025 `backtested` | konventionelles US-Preis-CAPE und Zuordnung Dezember `t-1` reproduzierbar; der Nutzungsrahmen der öffentlichen Quelle enthält keine ausdrückliche offene Weiterverbreitungslizenz, externe Validierung steht aus |

`qualitySegments` sind Evidenzsegmente. Sie ändern nicht die
Vollständigkeitsstatus von `HistoricalYearRecordV1` zur Laufzeit. Ein
endlicher Wert nach 1950 kann technisch vorhanden sein, während seine externe
Evidenz weiterhin `not_validated` bleibt.

Die statische Inventur deckt diese Produktklassen ab:

| Kategorie | Inventureinträge | Evidenzgrenze |
| --- | --- | --- |
| Demografie | `mortality_table` | eingebetteter Periodentafelproxy; genaue externe Tabelle, Transformation, Lizenz und Abruf ungeklärt |
| Pflege | `care_grade_taxonomy`, `care_incidence_probabilities`, `care_progression_probabilities`, `care_cost_presets` | Taxonomie/Proxy, geschätzte Umrechnung von Prävalenz zu Inzidenz und ausdrückliche Modellannahmen bleiben getrennt |
| Hinterbliebene | `widow_benefit_parameters` | Nutzereingabe-/Vorgabenvertrag, kein beobachteter Leistungsanspruch |
| Steuer/Tranchen | `capital_income_tax_parameters` | aktuelle parametrisierte Näherung; keine historische Steuersimulation oder externe Steuervalidierung |
| Rente/Soziales | `pension_user_defaults`, `social_insurance_parameters` | Nutzereingaben sind maßgeblich; eine automatische Sozialversicherungstabelle ist ausdrücklich `missing` und wird nicht erfunden |
| Stress/Regime | `stress_presets`, `regime_classification_thresholds`, `regime_transition_matrix` | jede Vorgabe unterscheidet historischen Filter, rekonstruiertes Fenster, hybride oder synthetische Evidenz; beibehaltene Modellschwellen und abgeleitete Übergangszahlen verwenden eigene Klassen und bleiben extern unvalidiert |
| Vorgaben/Ersatzwerte | `engine_policy_defaults`, `monte_carlo_defaults`, `longevity_defaults`, `tail_risk_defaults`, `health_bucket_defaults` | Regelannahmen und Stressvorgaben werden über Hashes geprüft, ohne dadurch als Beobachtungen zu gelten |

Die Quellenprüfung trennt drei Fragen:

1. `technicallyReproducible` verlangt einen passenden Hash des eingebetteten Werts.
2. `externallyValidated` verlangt den Validierungsstatus, geklärte Quelle,
   externe Kennung, Lizenz und Abrufdatum sowie eine passende Evidenzklasse.
3. `replacementAllowed` bleibt falsch, bis die externe Validierung bestanden ist.

Alle sechs historischen Reihen lassen sich deterministisch wiedergeben.
Quelle, Identität, Abruf, Rohdatenhash und Lizenz- beziehungsweise Nutzungsgrenze
sind geklärt. Der externe Validierungsstatus bleibt jeweils `not_validated`.
Die Aktienreihe ist ein Forschungsproxy mit modellierten Dividenden für
2021-2025; die Inflation enthält einen JST-Proxy bis 1949. Cash und Gold
enthalten Proxy- und Brückensegmente, Lohn ein frühes Modellsegment. CAPE ist
eine US-Forschungsreihe des Herausgebers ohne ausdrückliche offene
Weiterverbreitungslizenz. Alle Ersetzungsfreigaben bleiben deshalb bis zur
externen Prüfung gesperrt.

### Fachübergreifende Quellenstände des Modells

Das maschinenlesbare Marktmanifest und die amtlichen Quellenstände gehören
zu unterschiedlichen Evidenzklassen. Amtlicher Kontext wird nicht automatisch
in die App importiert. Ein Quellenzitat kalibriert keine eingebettete Tabelle
und validiert kein technisch getestetes Modell extern. Abrufdatum aller
folgenden Links ist 2026-07-28.

| Fachgebiet | Quelle / Datenstand | Einheit und vorgesehener Vergleich | Aktueller Implementierungsstand | Zuständigkeit / nächste Prüfung |
| --- | --- | --- | --- | --- |
| Kapitalertragsteuer | [EStG section 32d](https://www.gesetze-im-internet.de/estg/__32d.html) und [BMF/LStH 2026 section 43a](https://lsth.bundesfinanzministerium.de/lsth/2026/A-Einkommensteuergesetz/VI-Steuererhebung-36-47/3-Steuerabzug-vom-Kapitalertrag-KapSt-43-45e/Paragraf-43a/inhalt.html), Gesetzes-/Handbuchstand 2026 | EUR-Steuerbasis und Satzverhältnisse | Kirchensteuer bleibt eine dokumentierte vereinfachte Formel; keine vollständige Veranlagung | Nutzer / Steuerprüfer nicht zugewiesen; 2026-10-31 |
| Sterblichkeit | [Destatis period life table 2023/2025](https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Bevoelkerung/Sterbefaelle-Lebenserwartung/sterbetafel.html), Seitendatum 2026-07-07 | jährliche Sterbewahrscheinlichkeiten und Lebenserwartung nach Alter/Geschlecht | amtliche Vergleichsquelle nicht importiert; eingebettete Tabelle technisch geprüft, aber extern unvalidiert | Nutzer / versicherungsmathematischer Prüfer nicht zugewiesen; 2027-01-15 |
| Pflegeleistungen | [BMG benefits overview](https://www.bundesgesundheitsministerium.de/themen/pflege/online-ratgeber-pflege/leistungen-der-pflegeversicherung/leistungen-im-ueberblick/seite), aktualisiert am 2026-02-13 | EUR-Leistungsbeträge nach Pflegegrad | Leistungsbeträge kalibrieren weder Inzidenz noch Fortschreiten und werden nicht automatisch importiert | Nutzer / Pflegeprüfer nicht zugewiesen; 2027-01-15 |
| Pflegebevölkerung | [Destatis care population at end-2023](https://www.destatis.de/DE/Presse/Pressemitteilungen/2024/12/PD24_478_224.html), veröffentlicht am 2024-12-18 | Personen und Anteile zum Bestandsstichtag | Bestandsdaten belegen keine individuellen jährlichen Übergangswahrscheinlichkeiten | Nutzer / pflegeversicherungsmathematischer Prüfer nicht zugewiesen; 2027-01-15 |
| Gesetzliche Rente | [German Pension Insurance values](https://www.deutsche-rentenversicherung.de/DRV/DE/Experten/Zahlen-und-Fakten/Werte-der-Rentenversicherung/werte-der-rentenversicherung_node.html), abgerufen am 2026-07-28 | EUR und amtliche Verhältnisse/Datumsangaben | die App verwendet eingegebene Rentenbeträge und Fortschreibung; kein automatischer Import amtlicher Werte | Nutzer / nächster Rentenbescheid, spätestens 2027-01-15 |

Die verbindliche fachübergreifende Inventur, Validierungsachsen, Umfang und
Entscheidungsstatus stehen im
[`FACHKONZEPT.md`](FACHKONZEPT.md#modell--datenstands--und-validierungsmatrix).

### Stand der Forschungsprüfung

Das Simulator-Backtest-Forschungsprotokoll
(`SIMULATOR_BACKTEST_FORSCHUNGSPROTOKOLL.md`) verantwortet operativ
FV-G01 bis FV-G08 für FQ-01 bis FQ-03. Es ersetzt das Laufzeitmanifest
nicht und setzt kein Feld auf `known`.

| Offener Punkt | Aktueller Stand | Erforderliche Zuständigkeit und nächster Beleg | Sperrwirkung |
| --- | --- | --- | --- |
| genaue Aktien-Anbieterindexidentität | bewusst nicht anwendbar: `global_equity_research_index` ist ein benannter Forschungsproxy | externe Methodenprüfung kann ihn mit lizenzierten Anbieterindizes vergleichen, ohne den Proxy umzubenennen | sperrt Aussagen über Anbieterindexgleichheit, nicht die deterministische Nutzung |
| Lohnproxy gegenüber gesetzlicher Rentenanpassung | Destatis-Bruttoverdienstidentität geklärt; Laufzeitnutzung ausdrücklich nur als Rentenfortschreibungsproxy | unabhängige Prüfung im Rentenfachgebiet und bei Bedarf eine separate gesetzliche Anpassungsreihe | sperrt Aussagen, dass `lohn_de` amtliche Rentenanpassungen reproduziert |
| Weiterverbreitungsrahmen der Shiller-Arbeitsmappe | öffentlicher Download und Haftungsausschluss erfasst; keine ausdrückliche offene Weiterverbreitungslizenz gefunden | rechtliche Klärung beziehungsweise Klärung durch den Quelleninhaber vor weitergehenden Aussagen zur Weiterverbreitung | sperrt Aussagen über offene Daten oder uneingeschränkte Weiterverbreitung, nicht die lokale deterministische Rekonstruktion |
| Aktienproxysegmente | originale und gefilterte JST-/OECD-/ECB-Eingaben, Hashes und Transformation geklärt; USD-Proxy 1925-1950 und Modell mit festgehaltenen Dividenden 2021-2025 | unabhängige Methodenvalidierung und künftiger Ersatz der Dividendenquelle | verhindert Aussagen über einen Anbieterindex oder externe Validierung |
| Cash-/Geldmarktproxysegmente | JST-/Bundesbank-Eingaben, Hashes und Transformation geklärt; uneinheitlicher Proxy 1925-1944 und Fortschreibungsbrücke 1945-1948 | unabhängige Methodenvalidierung und künftiger Ersatz durch Beobachtungen vor 1949 | verhindert Aussagen über eine durchgehende investierbare Produktrendite oder externe Validierung |
| frühe Methodik und Übergänge von `gold_eur_perf` | Quellenkette und alle Nullwerte technisch geklärt; 1925-1967 bleibt Preisvorgaben-/Wechselkursproxy, 1945-1950 geschätzte Brücke, 1968 Teiljahresübergang, 1999 Quellen-/Bezugswährungswechsel | unabhängige Methodenvalidierung, Belege für Investierbarkeit/Marktzugang und Sensitivität gegenüber Produktkosten | verhindert Aussagen über eine durchgehende investierbare Privatkunden-Goldrendite oder externe Validierung |
| marktübergreifende CAPE-Interpretation | als konventionelles US-Preis-CAPE geklärt | unabhängige Methodenprüfung für globale/deutsche Regelvergleiche | sperrt die Behandlung der US-Kennzahl als globalen oder deutschen Bewertungsmaßstab |

Die eingebettete Historie 1925-2025 und alle daraus abgeleiteten Perioden oder
rollierenden Kohorten gelten für bestätigende Forschung als explorativ und
vorbelastet: Daten und Ergebnisse waren während der Entwicklung bereits
sichtbar. Ein roher `HistoricalBacktestExportV2` erfasst einen ausdrücklichen
Lauf, seine Quellen- und Datenherkunft sowie Fingerabdrücke. Er ist kein nur
durch Anhängen erweitertes Versuchsregister und belegt keinen vorab festgelegten Holdout.

### `HistoricalYearRecordV1` und Zuordnungsinventur

Der aktive Backtest-Datensatz trennt nachträglich bekannte `realized`-
Beobachtungen von Regeleingaben unter `decisionAsOf`. Jede Beobachtung enthält
`sourceYear`, `asOfYear`, Einheit, Ableitung und Qualität. Der Datensatz ist
mit `approved_d01` markiert und verwendet die Zeitkonvention
`realized_t_decision_t_minus_1_v1`.

| Simuliertes Feld im Jahr `t` | Bisheriger Backtest | Aktive `annualData` / Monte Carlo | Aktiver D-01-Backtest-Vertrag |
| --- | --- | --- | --- |
| Aktienrendite | Index `t / (t-1) - 1` | kanonische erzeugte jährliche Gesamtrendite `t` | realisiert `t`, Eingabeindexstände `t-1` und `t` |
| Goldrendite | `t-1` | `t` | realisiert `t` |
| Cash-/Anleiheproxy | `t-1` | `t` | realisiert `t` |
| Inflation | `t-1` | `t` | realisiert `t` |
| Lohn-/Rentenanpassung | `t` über `simStartYear - series.startYear + yearIdx` | `t` | realisiert `t` |
| CAPE | effektiver doppelter Zeitversatz im bisherigen Pfad | Schlüssel für Renditejahr `t` enthält das Signal aus Dezember `t-1` | Dezemberbeobachtung `t-1`, Datenstand `t-1`, Entscheidungsjahr `t`; kein zweiter Zeitversatz |

Markierungstests prüfen den Versatz der Rentenanpassung für 1950, 2000 und
2001. Der Normalisierer auf Portfolioebene
`simulator-year-portfolio.js:readYearReturnRates()` behält seine Rückgabeform für Ersatzwerte.
Der produktive Backtest-/Monte-Carlo-/Sweep-Adapter weist dagegen nicht
endliche Pflichtrenditen vor der Portfoliomutation ab.

`prepareHistoricalData()` prüft ausschließlich die Verfügbarkeit der
kanonischen, beim Modulstart initialisierten `annualData`. Es baut keinen
zweiten Datensatz mit anderer zeitlicher Verschiebung auf.
`HistoricalRegimeClassificationV1` wendet einen Klassifikator auf die
kanonischen Gesamtrendite- und Inflationsreihen an. Die beibehaltenen
absoluten Schwellen ergeben für 1925-2025 die Beobachtungszahlen 40 BULL,
6 BEAR, 49 SIDEWAYS und 6 STAGFLATION. Ihre Beibehaltung folgt einer
Verteilungsprüfung, bleibt aber ausdrücklich `not_validated` und ist keine
externe Kalibrierung. Leere Daten, leere Stresspools und unbrauchbare
Regimeübergänge führen zum Abbruch. Es werden weder Nullrenditen noch
`SIDEWAYS`-Beobachtungen oder Übergänge erfunden.

## Aussagegrenzen der historischen Reihen

- `global_equity_research_index` ist ein neutraler Forschungsproxy und darf
  weder als MSCI-Reihe angezeigt noch exportiert werden.
- Die OECD-Komponente für 2021-2025 ist ein Kursindex. Der Dividendenbaustein
  hält die länderspezifische JST-Dividendenrendite von 2020 konstruktionsbedingt
  konstant.
- Monte Carlo kann mit `mcExcludeEstimatedHistory` die als geschätzt
  gekennzeichneten Beobachtungen ausschließen.

## Reihenübersicht

- `global_equity_research_index`: offener, segmentierter globaler
  Aktien-Forschungsindexstand
- `inflation_de`: offene, segmentierte deutsche nationale CPI-Kette
  auf Basis von Jahresdurchschnitten
- `zinssatz_de`: jährlicher deutscher Zinsproxy
- `lohn_de`: JST-/Destatis-Forschungsproxy des Wachstums der
  Bruttomonatsverdienste ohne Sonderzahlungen; frühes JST-Segment 1925-1946
  und ausdrückliche Übergänge 1925/1945/1947/1948
- `gold_eur_perf`: Goldrenditeproxy auf Basis von Jahresdurchschnitten in
  deutscher Anlegerwährung mit ausdrücklichen Preisvorgaben-/Wechselkurs-,
  Brücken-, Frankfurter und EUR-Segmenten
- `cape`: konventionelles US-Shiller-Preis-CAPE,
  Entscheidungssignal aus Dezember `t-1`

## Offene Quellenarbeiten

- Gewichtungs- und Währungsmethodik des Aktienforschungsproxies unabhängig
  validieren.
- Den festgehaltenen Dividendenbaustein von 2020 ersetzen, sobald eine offene
  Quelle beobachteter Gesamtrenditen für 2021-2025 verfügbar ist.
- Den frühen Goldmarktzugangsproxy unabhängig validieren und die Sensitivität
  gegenüber Produktaufschlag, Spanne, Lagerung und Steuer quantifizieren.
