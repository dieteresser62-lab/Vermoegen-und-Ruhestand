# Datenquellen und Herkunft

Referenz für fachlich Interessierte und Entwickler zu Herkunft, Transformation und Datenqualität. Stand der Codeprüfung: 11.11.2026. Externe Abrufdaten und offene Prüfungen sind je Quelle ausgewiesen. [Technik](TECHNICAL.md) beschreibt Aufrufe, [Datenverträge](DATENVERTRAEGE.md) Records, [Regelverzeichnis](FACHKONZEPT.md) die Fachthemen.

## Live-Daten

### Kurse

Yahoo Finance liefert Quotes, Suche und Historie über den lokalen Proxy auf 127.0.0.1:8787. Browser: `scripts/serve.mjs`/`tools/yahoo-proxy.cjs`; Tauri: integrierter Rustdienst in `src-tauri/src/lib.rs`. Symbol/Suchbegriff und bei Historien Zeitraum/Intervall verlassen die App; Depotmengen, Einstand und Bedarf gehören nicht zum Request. Anbieter erhalten Transport-/IP-Metadaten.

`market-price-adapter.js` verlangt passendes Symbol, positiven endlichen Preis, EUR, UTC-Unixzeit und Quelle. Quotes älter als sieben Kalendertage oder mehr als fünf Minuten zukünftig werden abgewiesen; keine FX-Umrechnung. Sammelabrufe begrenzen Parallelität, deduplizieren Symbole und bestätigen gültige Teilergebnisse gemeinsam; fehlgeschlagene Lots behalten alte Kurse.

Der Jahresschritt fragt VWCE.DE vom 27. Dezember bis ausschließlich 1. Januar ab. Akzeptiert wird der letzte Schlusskurs 27.–31. Dezember des Zieljahres, 0,50–100.000 EUR. `annualMarketDataMeta` bindet Preis, asOf, Ticker, Quelle, Zieljahr, Periode und ATH-Prüfung. Falsches Jahr, leerer Verlauf oder fehlender Pflichtwert blockiert den Abschluss; Wiederherstellung bleibt beim Koordinator.

Die Balance-Vorschau liest VWCE.DE-EUR-Tagesschlüsse aus `rs_daily_prices_v1` im aktiven Speicherbereich. Sie ruft selbst keine Kurse ab. Letzter Schluss bis zum Fachdatum und höchster gespeicherter Schluss der gesamten Historie bis zu diesem Kurs liefern die beiden Lesarten; bei offenem Vorjahresabschluss endet der Zeitraum am 31. Dezember des Abschlussjahrs. Die Hochreferenz ist das Maximum aus Regelhoch und gespeichertem Schluss, auch nach einem Jahreswechsel. Bei gleichem Wert zählt für die Herkunft das spätere Datum; beide Varianten verwenden dann das Regelalter. Nur ein echt höherer gespeicherter Schluss liefert ein Bruchteilalter. Der Tageskursspeicher führt neue Abrufe mit vorhandenen Tagen zusammen und kürzt die Historie nicht. Der Vergleich nennt ersten und letzten gespeicherten Tag. Für einen belastbaren Budgetvergleich muss der letzte Schluss nach dem Bezugsjahresende liegen, darf am Fachdatum höchstens zehn Kalendertage alt sein (bei offenem Abschluss am Ende des Abschlussjahrs) und darf die Reihe keine unabgefragten Werktage zwischen erstem und letztem Schluss enthalten. Fehlt ein Schluss nach dem Bezugsjahresende, bleibt die Rechnung mit Jahresmarktdaten erhalten; der Anzeigegrund lautet „kein Tageskurs seit Jahresende VJ“. Ein fehlendes Übersichtsmodell, unklarer Jahresstand, Wiederherstellung oder ein Vorschaufehler liefert ebenfalls die Basisrechnung mit „ohne Kurs“. Fehler werden nur in der Konsole gemeldet. Spielbereich und Jahresabschluss behalten ihre bestehenden Kursquellen.

Manuelle Markt-CSV ist eine lokale Quelle: Modus current/historical, Zieljahr, erwartetes ISO-asOf, Instrument und Quelldateiname sind Pflicht. Schlusskurs und Datum müssen passen; drei Vorjahre belegen nur ein Vierjahres-Fensterhoch. `verifiedAllTimeHighAvailable` bleibt false. Nur ein strikt höheres Fensterhoch liefert eine konservative ATH-Untergrenze; Gleichstand bleibt neutral. Herkunft und `engineReference.policy = window_high_as_conservative_ath_lower_bound` bleiben im Importbeleg.

### Inflation

[balance-annual-inflation.js](../../app/balance/balance-annual-inflation.js), `createInflationReaders`, versucht ausschließlich:

| Reihenfolge | Endpunkt und Bedeutung |
|---|---|
| EZB | `https://data-api.ecb.europa.eu/service/data/HICP/A.DE.N.000000.4D0.AVR`; deutscher HICP/HVPI, Veränderung des Jahresdurchschnitts |
| Weltbank | `https://api.worldbank.org/v2/country/DEU/indicator/FP.CPI.TOTL.ZG`; deutscher CPI, jährliche Prozentänderung |

Der normalisierte Vertrag heißt `consumer_prices_all_items_annual_average_growth_pct`: rate −10 bis 50 Prozent, exakt targetYear, source, dataAsOf, fetchStatus ok_primary_ecb/ok_fallback_world_bank und metric. Unterschiedliche Indexfamilien bleiben in source sichtbar. Mehrdeutige/falsche Reihen, Jahre und nicht endliche Werte werden abgewiesen. Jede Quelle hat acht Sekunden Timeout und eigenen AbortController. Ohne gültige Antwort kein Write; fehlende Jahrespflichtwerte blockieren den Commit. Manuelle Bestätigung verwendet ok_manual, Spielkurse ok_synthetic.

Historischer Engineinput/Import erlaubt getrennt −15 bis 50, um 1932 darzustellen. Fortschreibung erfolgt multiplikativ auch bei Deflation, ohne Nullbegrenzung. Die historischen VPI-Reihen unten sind keine Live-HVPI-Antworten.

### CAPE und Offlinegrenze

[shiller-cape.js](../../app/shared/shiller-cape.js) lädt `https://www.shillerdata.com/` über r.jina.ai, akzeptiert daraus ausschließlich HTTPS-Links auf img1.wsimg.com mit Dateiende ie_data.xls und lädt diese über denselben Vermittler als HTML. Der Parser liest Date-/CAPE-Spalten, keine fremden HTML-Elemente in die Oberfläche. Datum und CAPE kommen aus derselben Tabellenzeile; sdval erhält ungerundete Zellwerte. Werte müssen strikt zwischen 5 und 80 liegen.

`annual-marketdata.js` führt shillerdata_xls und stored_last_value. Wegen des Veröffentlichungsverzugs der Shiller-Tabelle akzeptiert der Live-Jahresabschluss für das Zieljahr gültige Beobachtungen aus Oktober–Dezember dieses Jahres; die [historische Kette](#gemeinsame-konvention) ist dagegen auf Dezember des Vorjahres normiert. Gespeicherte/veraltete Werte bleiben mit capeAsOf/capeSource/capeFetchStatus/capeUpdatedAt erkennbar; die Jahresvorbereitung fordert bei fehlendem aktuellem Pflichtwert eine manuelle Bestätigung. Der Hinweis liest zuerst den CAPE des gültigen Haushaltsplans, ohne Plan die alten Balance-Metadaten; auch ein passender gespeicherter Planwert wird nicht automatisch bestätigt. CAPE erhält kein erfundenes ETF-Jahresenddatum. OECD und Yale sind keine zusätzlichen aktiven Live-Fallbacks.

Lokale Eingaben und gespeicherte Daten bleiben offline lesbar. Ein alter Kurs wird dadurch nicht aktuell; Pflichtabrufe im Jahresabschluss können eine manuelle Angabe verlangen. Tauri-CSP in `tauri.conf.json` begrenzt Verbindungen; eine erlaubte Domain beweist keinen aktiven Abruf. Schriften und Hilfegrafiken werden lokal ausgeliefert. `test:browser` ersetzt Anbieteranfragen durch Fixtures und blockiert sonstiges Netz; das ist keine Prüfung der Erreichbarkeit externer Dienste.

## Historische Reihen

### Gemeinsame Konvention

`app/simulator/simulator-data.js` bündelt 1925–2025. `HistoricalDataManifestV1`, Datensatz ruhestandsapp-historical-data-v1, Revision 2026-08-01.4, hält kanonischen SHA-256 über numerisch sortierte Jahre und lexikalisch sortierte Objektfelder. Der aktive Inhaltshash lautet `c79350c5abf2dee2feeaae65c88ed5e58487f878cb598fdffc132fbf48d01e79`.

`HistoricalYearRecordV1` trennt realized t von decisionAsOf t−1; Konvention realized_t_decision_t_minus_1_v1, Status approved_d01. Renditen, Inflation und Lohn gehören zu t; CAPE ist Dezember t−1 unter Schlüssel t, ohne zweite Verschiebung. `historical-backtest-contract.js` prüft Manifest, Reihenbrüche und Pflichtwerte einmal je Revision/Hash sowie jede angefragte Periode. Vier Lookbackjahre ergeben Laufgrenzen 1929–2025, auch ein Einjahreslauf ist erlaubt.

`prepareHistoricalData()` prüft die vorhandene annualData statt eine zweite verschobene Historie zu erzeugen. Produktive Adapter weisen nicht endliche Pflichtrenditen vor Mutation zurück. Monte Carlo, Sweep und Optimizer verwenden denselben Datenbestand, sind aber keine unabhängigen Holdouts. `mcExcludeEstimatedHistory` beginnt effektiv 1951; der Filter ersetzt keine Prüfung späterer Modellsegmente.

### Markt

Die folgende Matrix ist der einzige redaktionelle Reihenüberblick. Genaue Primärkopien, Roh-/Ergebnishashes, Feldmetadaten und Lizenzen stehen in den verlinkten Daten-READMEs; die Appmodule werden aus diesen Beständen erzeugt.

| Reihe und Einheit | Quelle, Zeitbezug, Transformation und Grenze |
|---|---|
| [global_equity_research_index](../../data/historical/global-equity-research-chain/README.md), Index/Gesamtrendite % p.a. | JST R6 für 16 Länder mit wirtschaftlichen Vorjahresgewichten; 1925–1950 USD-Proxy, 1951–2020 deutsche Anlegerwährung/backtested. OECD-Kursindex plus festgehaltene JST-Dividendenrendite 2020 für 2021–2025/estimated, ECB-Wechselkurse. Forschungsproxy, kein MSCI-/Anbieterindex oder investierbares Produkt. |
| [zinssatz_de](../../data/historical/german-cash-money-market-chain/README.md), nominal % p.a. | JST DEU.stir 1925–1944/proxy; 1945–1948 Fortschreibung 2,13 %/estimated; Bundesbank Frankfurter Tagesgeld 1949–1996/proxy, FIBOR O/N 1997–1998, EONIA 1999–2018, Übergang 2019, EURSTR 2020–2025. Jahresdurchschnitt einmal als cashBondReturn; kein Produkt-NAV, keine zusätzliche Verzinsung, Kosten, Marge, Steuer oder Anleiheduration. |
| [gold_eur_perf](../../data/historical/gold-german-investor-chain/README.md), nominal % p.a. | Jahresend-Preisvorgabe × JST-Jahresendwechselkurs 1925–1944 und 1951–1967/proxy; 1945–1950 Nullbrücke/estimated; Frankfurter Fixing 1968–1998/derived; World-Bank-Gold USD/Feinunze geteilt durch Bundesbank USD/EUR 1999–2025/derived. Keine Produkt-, Lager- oder Steuerkosten. |
| [cape](../../data/historical/us-shiller-cape-chain/README.md), Verhältnis | konventionelles US-Shiller-Preis-CAPE, kein Total-Return-CAPE, kein globales/deutsches CAPE. Dezember t−1 genau einmal verwendet. 1925–1935 estimated wegen Cowles-Interpolation vor 1926 im Zehnjahresfenster; danach backtested. |

Aktien: Die deutsche Rekonstruktion der Währungsreform trägt 1948 etwa −4,17 und 1949 +37,38 Prozentpunkte zur globalen Reihe bei, trotz rund fünf Prozent Gewicht. Dieses schwach belegte Proxyartefakt bleibt sichtbar; es ist kein belegtes globales Marktereignis. 1950 bleibt deshalb USD-Proxy. Die Folge darf keine Anbieterindexgleichheit beanspruchen.

Cash: Frankfurter Sätze sind ungewichtete gemeldete Monatsdurchschnitte, nicht amtlich festgesetzte Sätze. Berichtskreiswechsel März 1970 und Zinstagewechsel Juli 1990 sind Methodenbrüche. Das Bundesbank-PDF wird unabhängig nach Layout und Koordinaten extrahiert; Poppler pdftohtml ≥25.07.0, wählbar über RUHESTANDSAPP_PDFTOHTML/RUHESTANDSAPP_POPPLER_BIN/PATH. Extrakt ist kein Primär-Rohdatenhash.

Gold: 1933 letzter RFC-Ankaufspreis 34,06 USD, 1934 gesetzlich 35 USD. 1968 vergleicht ein Teiljahresmittel ab 18. Juni mit Jahresende 1967; ab 1969 Jahresdurchschnitte. 1999 wandelt 1,95583 DEM/EUR und 32.15074656862798 Feinunzen/kg um. Zwölf echte Nullen sind erklärt: sechs aus identischen Komponenten, sechs Brückenjahre. JST 1946–1949 ist ausgeschlossen; Marktzugang und Kriegsbrücke bleiben ungeprüfte Investierbarkeitsgrenzen.

### Fondskosten Aktien

Die Aktienreihe ist eine Brutto-Gesamtrendite: Dividenden vor Quellensteuer, ohne Fondskosten. Backtest und Monte Carlo ziehen deshalb je Jahr die „Laufenden Kosten Aktien-ETF“ k ab: (1 + r) × (1 − k) − 1 (FR-76). Gold und Geldmarkt bleiben ohne Abschlag. Balance rechnet mit echten Kursen; die enthalten die Kosten schon. Der Wert steht in Haushalt & Plan. Mit Dynamic Flex mindert er in Balance und Simulator auch die erwartete Aktienrendite: (1 + e) × (1 − k) − 1.

Vorgabe k = 0,5 % pro Jahr, gerundet auf 0,1 Prozentpunkte. Abrufe vom 11.11.2026:

| Baustein | Wert | Quelle |
|---|---|---|
| Laufende Kosten (TER) | iShares Core MSCI World 0,20 %, iShares MSCI ACWI 0,20 %, Vanguard FTSE All-World 0,14 %, Xtrackers MSCI World 0,12 % | justETF, ISIN [IE00B4L5Y983](https://www.justetf.com/en/etf-profile.html?isin=IE00B4L5Y983), [IE00B6R52259](https://www.justetf.com/en/etf-profile.html?isin=IE00B6R52259), [IE00BK5BQT80](https://www.justetf.com/en/etf-profile.html?isin=IE00BK5BQT80), [IE00BJ0KDQ92](https://www.justetf.com/en/etf-profile.html?isin=IE00BJ0KDQ92) |
| Brutto minus Net, MSCI World (USD) | 10 Jahre 13,50 % − 12,95 % = 0,55 Prozentpunkte p. a.; 1 Jahr 0,42; Kalenderjahre 2012–2025 0,41 bis 0,73; MSCI ACWI 10 Jahre 0,54; Dividendenrendite 1,54 % | MSCI Factsheets vom 30.10.2026, [Brutto](https://www.msci.com/documents/10199/178e6643-6ae6-47b9-82be-e1fc565ededb), [Net](https://www.msci.com/documents/10199/4db922ce-68d2-446d-2f9e-4ed408a9db29) |
| Tracking-Differenz gegen den Net-Index | iShares Core MSCI World im Mittel seit 2010 0,03 % p. a., Jahreswerte 2016–2025 zwischen −0,2 und 0,0; Vanguard FTSE All-World seit 2020 0,02 % p. a. | trackingdifferences.com, [IE00B4L5Y983](https://www.trackingdifferences.com/ETF/ISIN/IE00B4L5Y983), [IE00BK5BQT80](https://www.trackingdifferences.com/ETF/ISIN/IE00BK5BQT80) |

Rechenweg: Kosten gegenüber der Bruttoreihe = (Brutto − Net) + Tracking-Differenz gegen Net. Der Net-Index zieht die höchsten Quellensteuersätze ab. Ein irischer ETF zahlt weniger; dieser Vorteil und Erträge aus Wertpapierleihe gleichen die TER fast aus. Das ergibt mit dem Zehnjahresabstand 0,55 + 0,03 ≈ 0,6 % und mit dem Abstand der letzten zwölf Monate bei heutiger Dividendenrendite 0,42 + 0,03 ≈ 0,45 %. Die Vorgabe 0,5 % liegt dazwischen. Sie gilt für einen breiten Welt-ETF; ein eigener Wert ist möglich.

### Inflation und Lohn

[Inflation](../../data/historical/german-cpi-chain/README.md), inflation_de, misst nationalen CPI-Jahresdurchschnitt, keinen HICP. JST-Lebenshaltungskosten 1925–1949/proxy; Destatis 1950–1962 Vierpersonenhaushalte mittleren Einkommens im früheren Bundesgebiet, 1963–1991 alle privaten Haushalte, 1992–2025 deutscher VPI. Übergangsraten werden innerhalb ihrer Quelle gebildet. Quellenstände 2025-06 und 2026-07-10; 2024/2025 jeweils 2,2 %.

JST-Indexrundung begrenzt frühe Raten auf etwa 0,48–0,85 Prozentpunkte Auflösung. Preiskontrollen 1936–1948 und Übergang 1949 bleiben sichtbar: JST +7,0352 % statt −1,0526 % aus den Destatis-Ständen 28,5→28,2. Der Halbjahresdurchschnitt 1948 darf nicht als voller Vorjahreswert dienen. Amtliche Raten werden gegen gerundete Indizes mit maximal 0,05 Prozentpunkten geprüft; Mutationen ±0,1 scheitern.

Die [Währungsreform 1948](https://www.bundesbank.de/de/aufgaben/themen/waehrungsreform-1948-614040) wertete wesentliche Geldbestände 100:6,5 ab. Inflation und Cashproxy bilden diesen separaten Bestandsverlust nicht ab. Auch die Goldbrücke konstruiert keine durchgehend investierbare Währung. Ein reformübergreifender Lauf ist deshalb keine reale Geldbestandsbiografie.

[Lohn](../../data/historical/german-gross-wage-growth-chain/README.md), lohn_de in Prozent p.a.: JST DEU.wage 1925–1946/proxy, Destatis durchschnittliche Bruttomonatsverdienste ohne Sonderzahlungen 1947–2025. Früheres Bundesgebiet bis 1990, Gesamtdeutschland ab 1991, Methodenwechsel 2007/2022. Ab 1947 veröffentlichte Veränderung direkt nutzen, keinen Indexquotienten über Quellen hinweg. Frühe Indexrundung 1947–1955 kann relativ etwa 2,8 % beeinflussen.

1925 ist Normierungsbeginn, 1945 estimated, 1947 Quellenwechsel, 1948 Reformkontext. Die beibehaltene Indexveränderung 1945 +22,687439 % ist kein beobachteter Marktlohn; 0-%-Brücke ist Sensitivitätsreferenz mit derselben einjährigen Differenz. Laufzeitnutzung bei rentAdjMode wage einmal als allgemeiner Rentenfortschreibungsproxy, keine gesetzliche Rentenanpassungsreihe. Als Rentenproxy ist die Reihe optimistisch: Über 1925–2025 steigt sie real im Mittel um rund 2,6 % pro Jahr, 1950–1975 um rund 5,2 %, seit 1992 nur um rund 0,6 %. Deshalb ist „wie Inflation“ die Vorgabe für neue Personen und Beispiele (FR-74).

## Lebensereignisse

### Sterblichkeit

[Demografie-/Pflegevertrag](../../data/static/german-demography-care-survivor-contract/README.md) erzeugt `german-demography-care-survivor-contract.js`. Destatis Statistischer Bericht Sterbetafeln 2023/2025, EVAS 12621, Tabellen 12613-b01/-b02: jährliches qx Männer/Frauen für Laufzeitalter 18–100. Periodenbeobachtung, keine Kohortenverbesserung. Alter 101–110 ist Modellfortsetzung, 110 terminal; divers verwendet den ungewichteten Mittelwert, keine amtliche dritte Tabelle. Laufzeittabellenhash: `88c1000eac950016a65e7408127d5c1256683946933b710a0c28f672fde5f232`.

[Kohortensterbetafel](../../data/historical/german-cohort-life-table/README.md) erzeugt `german-cohort-life-table.js` und ist seit FR-75 die Zieltafel für Monte Carlo und Planungshorizont. Destatis Statistischer Bericht Kohortensterbetafeln für Deutschland 1926–2026, EVAS 12621, erschienen 16.09.2026, Tabellen 12621-b03/-b04: qx der Variante V2 „mittel“ je Geburtsjahrgang 1926–2026 und Alter 18–99. V2 ist das Mittel der qx von V1 (Trend 2011–2021) und V3 (Trend 1971–2024), fest und ohne Auswahl. Ab 100 gilt der Periodenschwanz, skaliert mit dem Verhältnis Kohorte/Periode bei 99; 110 bleibt terminal. Jahrgänge außerhalb 1926–2026 nutzen den Rand. Die Periodentafel bleibt im Demografievertrag für die Pflegeabstimmung nach FR-41 (Querschnitt 2023). Quellhash `724baa7893854da51dfb2991c5bc03174c046a34e96d6230eb08e5d579504379`, qx-Hash `708ce991b0d709fb1af7ed307b7b128f9fa3fb2e8ede9a8f2aabfa9e9057370a`.

### Wohnrechtbewertung

Quelle ist das [BMF-Schreiben vom 21.10.2025 mit Anlage](https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Erbschaft_Schenkungsteuerrecht/2025-10-21-bewert-lebensl-nutzung-leistung-1-1-26.pdf?__blob=publicationFile&v=5), GZ IV D 4 – S 3104/00002/013/003, für Bewertungsstichtage ab 01.01.2026. Abruf 27.10.2026 über die [Kopie des BMF-Originals bei Beck](https://rsw.beck.de/docs/librariesprovider112/default-document-library/12_steu_bmf_2025-10-21-bewert-lebensl-nutzung-leistung-1-1-26.pdf?sfvrsn=82a95382_1); der direkte BMF-Abruf lieferte HTTP 503. Grundlage: Destatis-Sterbetafel 2022/2024, 5,5 % Zins, gemittelte vor-/nachschüssige Nutzung. Einheit: dimensionsloser Vervielfältiger je vollendetem Alter 0–100 und Geschlecht.

`app/shared/bmf-lifetime-use-2026.js` übernimmt 202/202 Kapitalwertfaktoren der Anlage unverändert; der PDF-Abgleich ist vollständig. `life-expectancy.js` wählt nach Alter und Geschlecht, ab 100 die letzte Zeile, bei fehlendem Geschlecht Frauenwerte. Spätere Todesjahre verwenden die neueste eingebaute Tabelle; kein automatischer Jahresabruf. Die [Wohnrechtsteuer](STEUERN.md#wohnrecht-und-jährliche-zahlung) verwendet diese Faktoren. Die Todeswahrscheinlichkeiten der Simulation bleiben davon unberührt.

Nutzung als amtliche Bekanntmachung nach [§ 5 UrhG](https://www.gesetze-im-internet.de/urhg/__5.html), keine Übertragung der Projekt-MIT-Lizenz auf die Quelle. Die Herkunft bleibt genannt und die Tabellenwerte bleiben unverändert; BMF-Logo und Verlagsgestaltung werden nicht übernommen.

### Pflege

Destatis-Pflegestatistik 31.12.2023, Tabellen 22421-01/-02, belegt Bestände, Prävalenz und Gradanteile. Beobachtung und jährliche Eintritts-/Fortschrittsannahmen bleiben getrennt; keine Prävalenz/Dauer-Umrechnung. `careObservationHash`: `c9b55d32c1d084ba948e2b77bddb7392c918bce14ec11c908ab38afde8c9a48a`.

`calibrate-care-model.mjs` stimmt Eintritt, Fortschritt und sofortige Sterblichkeitsfaktoren intern auf diese Ziele ab, Seed 4102026, je 200.000 Personen ab 65. Nur die Abstimmkohorte startet mit 4,25 % Männern/4,42 % Frauen aus Altersgruppe 60–64, Zellen I46/I68, verteilt nach C34:C38. Einzelalter 65 und Kreuztabelle Alter×Grad fehlen. Pflege wird vor Tod gezogen, Jahresendquoten zählen Überlebende; Grade werden über alle Altersgruppen verglichen. Keine externe Validierung, keine individuelle Dauervorhersage. Parameter und Preiswirkung stehen in [Pflege](PFLEGE.md).

Pflegeleistungen: [BMG-Übersicht 2026](https://www.bundesgesundheitsministerium.de/fileadmin/Dateien/3_Downloads/P/Pflegeversicherung_Leistungsbeitraege/Uebersicht_Leistungsbetraege_2026_VA.pdf), Stand 11.12.2025, S. 1–3, geprüft 22.10.2026, belegt `care-benefits.js`. Die Betragsdarstellung steht am fachlichen Hauptort [Pflegegeld](PFLEGE.md#pflegegeld); zweckgebundene Leistungen sind keine frei verfügbare Einkunft.

Die amtliche Durchschnittsstaffel ist eine Modelltransformation aus Destatis I34:I38 geteilt durch C34:C38 und [vdek vom 14.07.2026](https://www.vdek.com/presse/pressemitteilungen/2026/stationaere-pflege-eigenanteile-juli-2026.html): 3.364 EUR monatlicher Eigenanteil im ersten Heimjahr, Stand 01.07.2026, Quellenprüfung 21.10.2026. Heimanteil × Eigenanteil ×12, auf 100 EUR gerundet; `household-care-values.js` verwendet bestätigte Haushaltswerte. Häuslicher Zusatz 0 ist Annahme, die Mischstaffel keine amtliche Individualkostenstatistik. Ambulant/Premium bleiben Szenariovorgaben.

### Rente und Hinterbliebene

Renten sind Nutzereingaben, keine automatische DRV-Übernahme. [DRV-Hinterbliebenenrente](https://www.deutsche-rentenversicherung.de/DRV/DE/Rente/Allgemeine-Informationen/Rentenarten-und-Leistungen/Renten-an-Hinterbliebene/renten-an-hinterbliebene_node.html) ist der Orientierungsbeleg zur Vorgabe percent/55. Anspruch, altes Recht und sämtliche Sonderfälle werden nicht vollständig geprüft. Modellrechnung und Quelle des Rentenwerts stehen in [Tod und Erbe](TOD_UND_ERBE.md#einkommen-und-bedarf). Der erzeugte Hinterbliebenenvertrag führt ebenfalls defaultMode percent; eine alte Angabe stop ist überholt.

## Herkunftsregister

### Status und Rekonstruktion

`SimulationDataInventoryV1` ergänzt das Laufzeitmanifest um statische Modellklassen. Auflösungsfelder known/unresolved/not_applicable führen Quelle, externe Kennung, Einheit, Währung, Zeitbezug, Transformation, Lizenz, Abruf und Roh-/Wertehash. unresolved verlangt value null. Qualität present/estimated/unresolved/fallback_zero/missing ist davon getrennt. Fehlende/nicht endliche Pflichtwerte scheitern; keine aktuelle Reihe erlaubt fallback_zero. qualitySegments belegen Evidenz, nicht Laufzeitvollständigkeit. Das Inventar fasst CAPE gröber als backtested zusammen; die Kettenmetadaten kennzeichnen 1925–1935 zusätzlich estimated.

Statische Klassen: mortality_table; care_grade_taxonomy/observed_prevalence/incidence_probabilities/progression_probabilities/cost_presets; widow_benefit_parameters; capital_income_tax_parameters; pension_user_defaults/social_insurance_parameters; stress_presets/regime_classification_thresholds/regime_transition_matrix sowie engine_policy/monte_carlo/longevity/tail_risk/health_bucket_defaults. Eine automatische Sozialversicherungstabelle bleibt missing. Regimeschwellen ergeben 40 BULL, 6 BEAR, 49 SIDEWAYS, 6 STAGFLATION; leere Pools werden nicht mit erfundenen Übergängen gefüllt.

technicallyReproducible bedeutet passender Wertehash. externallyValidated braucht unabhängigen Status und geklärte Herkunft; replacementAllowed bleibt bis dahin false. Quellenidentität und Nutzungsgrenze sind bei den sechs Ketten dokumentiert, externe Validierung bleibt not_validated. Build-/Verify-Befehle stehen in den jeweiligen Daten-READMEs und `package.json`; die Verify-Varianten schreiben keine Quellen um.

### Lizenzen

Projekt-MIT gilt nicht automatisch für Daten. JST-abgeleitete Teile: CC BY-NC-SA 4.0; Destatis: Datenlizenz Deutschland Namensnennung 2.0; World Bank: CC BY 4.0; OECD sowie Bundesbank/ESCB mit eigenen Bedingungen, EURSTR mit ECB-Haftungsausschluss. Shiller: öffentlicher Download und Haftungsausschluss, keine ausdrückliche offene Weiterverbreitungslizenz gefunden. Attributionen, Primärkopien und genaue Lizenztexte verbleiben bei den Datenketten. Diese Grenzen werden durch Hashprüfungen nicht aufgehoben.

### Modellgrenzen und Validierung

| Erhaltene Kennungen | Annahme und Risiko |
|---|---|
| A-01/A-02, MR-09, PD-01 | Jahresschritte, nominaler Bedarf zu Jahresbeginn, einmalige Deflation mit fortgeschriebenem Faktor |
| A-03 | feste Einkünfte zuerst für Grundbedarf/Flex, Rest persönlich; alte Rentenbeschränkung durch FR-42 ersetzt |
| A-04, MR-01/MR-02 | Forschungsproxies und modellierte Dividenden, keine Anbieterindexäquivalenz oder Verteilungsgarantie |
| A-05/A-06, MR-03/MR-04 | EUR ohne FX, keine vollständigen separaten Kosten-Cashflows |
| A-07, MR-05 | vereinfachte Steuer einschließlich fehlender Vorabpauschale/Günstigerprüfung |
| A-08/A-09, MR-07/MR-10, PD-02 | Pflege-/Mortalitätsannahmen, interne Abstimmung, Kosten-/Dauerunsicherheit, einmalige Driftnormalisierung |
| A-10/A-11, MR-06/MR-08, PD-03 | gesperrter Pflegebucket und Cash-Bond-Proxy; verschiedene KPI-Basen/Nenner |
| A-12/A-13, MR-11/MR-12 | Planung ohne reale Ausführung, eingefrorener Stand, Sampling-/Policy- und Eingaberisiken |

Die folgende Matrix erhält zehn Domänen, Owner, Belegdatum, Umfang, drei Validierungsachsen und Reviewfristen. Keine Achse gibt eine andere frei. ModelValidationStatusVocabularyV1 trennt technically_tested, partially_plausibilized, not_validated und custom_evaluator_not_assessed. Die Datenrevision ist am aktuellen Manifest geprüft; externe Abrufdaten werden nicht erneuert.

| ID / Domaene | Owner | Implementierte Quelle, Datenstand und Einheit | Geltungsbereich / wesentliche Grenze | Technisch getestet | Intern plausibilisiert | Extern validiert | Naechster Review |
| --- | --- | --- | --- | --- | --- | --- | --- |
| MS-01 Markt-/Inflationshistorie | Daten-Owner: Nutzer; externe Datenpruefung unbesetzt | `HistoricalDataManifestV1`, Revision `2026-08-01.4`, Jahre 1925-2025; `global_equity_research_index`, Prozent p.a., CAPE-Verhaeltnis | offene Forschungsproxykette statt Anbieterindex; Aktiensegmente 1925-1950 USD-Proxy, 1951-2020 deutsche Anlegerwaehrung, 2021-2025 modellierter Dividendenbaustein; keine Verteilungsgarantie | ja, Manifest-/Hash-/Sampling-/Vollnachrechnungsvertraege | teilweise, interne Konsistenz und Ausschlussfilter | nein | 2027-01-15 oder vor jeder Datenrevision |
| MS-02 Steuer | Fach-Owner: Nutzer; Steuerreview unbesetzt | vereinfachte Kapitalertragsteuer in `tax-settlement.mjs` und `sale-engine.mjs`; Vergleich: [Paragraph 32d EStG](https://www.gesetze-im-internet.de/estg/__32d.html), [BMF/LStH 2026 Paragraph 43a](https://lsth.bundesfinanzministerium.de/lsth/2026/A-Einkommensteuergesetz/VI-Steuererhebung-36-47/3-Steuerabzug-vom-Kapitalertrag-KapSt-43-45e/Paragraf-43a/inhalt.html), Abruf 2026-07-28; EUR und Steuersaetze als Verhaeltnis | Planungsnaeherung, keine Veranlagung; Kirchensteuerminderung in gemeinsamer Satzfunktion | ja, heutiger Contract | teilweise, nur implementierte Formel | nein | 2027-01-15 oder vor Steuerjahr-/Formelaenderung |
| MS-03 Ausgaben | Produkt-Owner: Nutzer | importierte Kategorien als vorzeichenbehaftete EUR-Betraege; Monats-/Jahresaggregation; Contractstand 2026-07-28 | aktueller Wert ist Betrag der saldierten Kategorien und damit Netto-Cash-Abfluss, keine Bruttoausgabe; D-12 offen | ja, Metrik-/Importvertraege | teilweise | nein | 2027-01-15 |
| MS-04 Verkauf/Reconciliation | Produkt-Owner: Nutzer; Accounting-Review unbesetzt | bestaetigte Stuecke, Nettoerloes, Gebuehr und append-only Cashnachweis/-korrektur in EUR; Contractstand 2026-08-07 | bestaetigte Lots werden entfernt; Verkaufserloes wird nicht automatisch gebucht; Cashstand bleibt eine explizite Nutzereingabe | ja, Reconciliation-, Persistenz- und Browser-Vertraege | teilweise, operativer Ablauf dokumentiert | nein | 2027-01-15 |
| MS-05 Mortalitaet | Modell-Owner: Nutzer; aktuarielle Pruefung unbesetzt | Zieltafel ist die Destatis-Kohortensterbetafel 1926-2026, Variante V2 (mittel), je Person nach Geburtsjahr, qx fuer Maenner/Frauen 18-99; ab 100 Periodenschwanz mal Verhaeltnis bei 99, 110 terminal, divers-Mittelwert; Grundsterblichkeit ohne Pflege je Person exakt abgesenkt (FR-75); Pflegegrad heute mit langsamem Verlauf stirbt mindestens wie die Zieltafel; Periodentafel 2023/2025 nur fuer die Pflegeabstimmung (FR-41); Contractstand 2026-11-12.2; amtlicher Anker: [Destatis Statistischer Bericht Kohortensterbetafeln](../../data/historical/german-cohort-life-table/README.md), erschienen 2026-09-16, Quellhash siehe oben; Wahrscheinlichkeit p.a. | maximal zwei demografische Personen; Kohortenmodell mit amtlicher Trendannahme V2, keine individuelle Diagnose; kein Tod in Ansparjahren | ja, Lebensereignis-/Runnervertraege | teilweise, exakte Gesamtsterblichkeit und Stichprobe gegen die Zieltafel | nein | 2027-01-15 oder vor Tabellenrevision |
| MS-06 Pflege | Modell-Owner: Nutzer; Pflege-/Aktuarreview unbesetzt | GermanDemographyCareSurvivorContractV1, Revision 2026-10-21.2; amtliche Pflegebestaende 2023 als Kontext und Ziel interner Simulationsabstimmung; Eintritt und Progression Modellwahrscheinlichkeiten p.a.; amtliche Kontexte: [BMG-Leistungen, Stand 2026-02-13](https://www.bundesgesundheitsministerium.de/themen/pflege/online-ratgeber-pflege/leistungen-der-pflegeversicherung/leistungen-im-ueberblick/seite), [Destatis Pflegebestand Ende 2023](https://www.destatis.de/DE/Presse/Pressemitteilungen/2024/12/PD24_478_224.html), Abruf 2026-07-28 | keine Praevalenz-zu-Inzidenz-Umrechnung; anfänglicher Eintritt PG1/2 und Progression bis PG5, Dauer, individuelle Kosten und Leistungen nicht gemeinsam extern kalibriert | ja, Care-/Workervertraege | teilweise, interne Simulationsabstimmung und Grenz-/Monotoniechecks | nein | 2027-01-15 oder vor Parameterrevision |
| MS-07 Rente | Eingabe-Owner: Nutzer; Fachreview unbesetzt | manuelle Brutto-/Netto-Jahreswerte in EUR und Nutzersteigerung in Prozent p.a.; Referenz: [DRV-Werte](https://www.deutsche-rentenversicherung.de/DRV/DE/Experten/Zahlen-und-Fakten/Werte-der-Rentenversicherung/werte-der-rentenversicherung_node.html), Abruf 2026-07-28 | keine automatische DRV-Datenuebernahme, keine individuelle Bescheid- oder vollstaendige Steuerpruefung | ja, Input-/Pensionsvertraege | teilweise, Nutzereingabe bleibt massgeblich | nein | bei jedem neuen Rentenbescheid, spaetestens 2027-01-15 |
| MS-08 Sweep/Auto-Optimize | Methoden-Owner: Nutzer; unabhaengiger Statistikreview unbesetzt | MC-Datenhashes, Sampling-/Seed-/CAPE-Contract und Optimizer-Modellversion; dimensionslose Scores sowie Ergebnis-KPIs; Contractstand 2026-07-28 | experimentelle Punktschaetzung beziehungsweise Kandidatensuche; kein globales Optimum und keine Empfehlung | ja, Parameterfidelity/CRN/Ergebnisvertraege | teilweise, synthetische und interne Szenarien | nein | 2027-01-15 oder vor produktiver Entscheidungsnutzung |
| MS-09 Kosten/FX/Asset-Universum | Produkt-Owner: Nutzer; Portfolio-Review unbesetzt | EUR-Einwaehrungsmodell; pauschaler Abschlag „Laufende Kosten Aktien-ETF“ als Planwert auf die Aktienrendite in Simulator und Dynamic Flex (FR-76, Vorgabe 0,5 %); keine separate Einheit fuer Spread, Slippage und Gebuehren-Cashflows; Scope-Inventur 2026-07-28, Kostenabschlag 2026-11-11 | keine FX-Konvertierung; enges ETF-/Gold-/Cash-/Bond-Proxy-Universum; reale Nettorendite kann niedriger sein | entfaellt, kein Kosten-/FX-/breites Assetmodell vorhanden | nein | nein | 2027-01-15 oder vor Erweiterung des Assetmodells |
| MS-10 Alarmstaerke | Policy-Owner: Nutzer | `flex-rate-policy.mjs`; dimensionsloser UI-Schweregrad; Contractstand 2026-07-28 | bei jeder nicht negativen Unterdeckung effektiv konstant `10`; D-11 offen | ja, Ist-Verhalten | nein, keine beschlossene monotone Fachfunktion | nein | 2027-01-15 oder vor Engine-Aenderung |

### Offene Datenarbeiten

Unabhängige Prüfung von Aktiengewichtung/-währung, Reformartefakt, festgehaltenen Dividenden und früher Goldinvestierbarkeit bleibt offen. Lohnproxy braucht Rentenfachprüfung, CAPE eine marktübergreifende Methodenprüfung und Klärung des Weiterverbreitungsrechts. Historie und rollierende Kohorten waren während der Entwicklung bekannt: explorativ/vorbelastet, kein vorab festgelegter Holdout. Ein HistoricalBacktestExportV2 ist kein dauerhaftes Versuchsregister.

Der Messbeleg post-backtest-data-07-v1 mit 2.048 MC-Pfaden/40 Jahren und zwei Sweeps isoliert den Sterblichkeitstabellentausch; Status pending bleibt erhalten. Er ist keine externe Validierung. Reviewtermine, Abrufstände und offene Quellenprüfungen stehen im [Marktregister](MARKTVERGLEICH_EVIDENZREGISTER.md#aktualität-und-fälligkeitsvertrag) und [Forschungsregister](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#aktualitaetsvertrag).
