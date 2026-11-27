# Rückwärtsprobe 2025 gegen die heutigen Quellen

Lauf am 2026-11-17 mit `npm run jahresdaten:rueckwaertsprobe -- --live`. In einer Wegwerfkopie wurde 2025 entfernt und mit `--holen` neu abgerufen. Jede geholte Lieferung ist mit der Lieferung aus den gespeicherten Originalen von JD-2a verglichen. Danach liefen `--pruefen` und `--uebernehmen` mit den geholten Lieferungen.

Genau die gespeicherten Werte liefern heute: Aktien, Inflation, Geldmarkt, Lohn, Gold. Nur im Rundungsrauschen oder innerhalb der Anschlusstoleranz weichen ab: CAPE. Die Übernahme erzeugt deshalb nicht genau den gespeicherten Datensatz: Inhaltshash `242bd658…` statt `c79350c5…`.

Abruf: Exit 0. Prüfung: Exit 0. Übernahme: Exit 0. Inhaltshash nach der Übernahme `242bd65889bfaecbfcfc399a5e65d1372cc783bfad474c11d47e6805ca5842a4` (Grundbestand nicht gleich).

| Kette | Status | Felder | gleich | Rauschen | in Toleranz | Abweichung | Zeile 2025 bytegleich |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Aktien | endgueltig | 48 | 48 | 0 | 0 | 0 | ja |
| Inflation | endgueltig | 4 | 4 | 0 | 0 | 0 | ja |
| Geldmarkt | endgueltig | 3 | 2 | 0 | 0 | 0 | ja |
| Lohn | endgueltig | 4 | 4 | 0 | 0 | 0 | ja |
| Gold | endgueltig | 4 | 4 | 0 | 0 | 0 | ja |
| CAPE | endgueltig | 2 | 0 | 2 | 0 | 0 | nein |

Rauschen heißt: Abstand unter einem Billionstel des Werts, etwa durch eine neu gespeicherte Arbeitsmappe. „In Toleranz“ heißt: innerhalb der Anschlusstoleranz der Kette.

## Aktien

- Heutige Quelle: OECD Share prices (DF_FINMARK 4.0) und EZB-Referenzkurse (EXR), Monatsdurchschnitt, https://sdmx.oecd.org/public/rest/data/OECD.SDD.STES,DSD_STES@DF_FINMARK,4.0/AUS+BEL+CHE+DEU+DNK+ESP+FIN+FRA+GBR+ITA+JPN+NLD+NOR+PRT+SWE+USA.M.SHARE.IX._Z._Z._Z._Z.N?startPeriod=2024-12&endPeriod=2025-12&dimensionAtObservation=AllDimensions&format=csvfilewithlabels, Abruf 2026-11-17, OECD Stand beim Abruf am 2026-11-17; EZB Stand beim Abruf am 2026-11-17.
- Original: OECD Share prices (DF_FINMARK) und EZB-Referenzkurse (EXR), Monatswerte, OECD oecd-share-prices-monthly.csv, EZB ecb-fx-monthly.csv (Stand der festgeschriebenen Originale).
- Methode heute: abgerufen: Dezemberwerte Y und Y−1 aus der OECD-Schnittstelle und der EZB-Schnittstelle. Methode Original: aus Original: Dezemberwerte aus den festgeschriebenen OECD- und EZB-Monatsdateien.
- Hinweis des Lesers: Kurse: https://data-api.ecb.europa.eu/service/data/EXR/M.AUD+CHF+DKK+GBP+JPY+NOK+SEK+USD.EUR.SP00.A?startPeriod=2024-12&endPeriod=2025-12&format=csvdata
- Alle 48 Felder gleich.

## Inflation

- Heutige Quelle: Destatis, Verbraucherpreisindex für Deutschland, Jahrestabelle (Verbraucherpreise-12Kategorien), https://www.destatis.de/DE/Themen/Wirtschaft/Preise/Verbraucherpreisindex/Tabellen/Verbraucherpreise-12Kategorien.html, Abruf 2026-11-17, Stand 17. November 2026.
- Original: Destatis, Verbraucherpreisindex für Deutschland, Jahrestabelle, 2026-07-10.
- Methode heute: abgerufen: veröffentlichte Jahresrate und Jahresdurchschnitt für Y und Y−1 aus der Destatis-Jahrestabelle. Methode Original: aus Original: veröffentlichte Jahresrate und Jahresdurchschnitt aus der festgeschriebenen Destatis-Jahrestabelle.
- Alle 4 Felder gleich.

## Geldmarkt

- Heutige Quelle: EZB, Euro short-term rate (€STR), Tageswerte; Gegenprüfung Bundesbank BBMMB Monatsdurchschnitte, https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT?startPeriod=2024-01-01&endPeriod=2025-12-31&format=csvdata, Abruf 2026-11-17, EZB Stand beim Abruf am 2026-11-17, Tageswerte bis 2025-12-31.
- Original: Deutsche Bundesbank, Lange Zeitreihen, Geldmarktsätze (Tagesgeld), Seiten 15–16, Datenstand 2026-03-05.
- Methode heute: Mittel der €STR-Tageswerte: einfaches Mittel aller Veröffentlichungstage des Jahres, kaufmännisch auf zwei Stellen gerundet. Methode Original: aus Original: veröffentlichter Jahresdurchschnitt Tagesgeld (erste Spalte) aus dem festgeschriebenen Layouttext.
- Hinweis des Lesers: €STR 2025: 255 Tageswerte 2025-01-02 bis 2025-12-31, Mittel ungerundet 2.1781.

| Teil | Feld | heute | Original | Einordnung |
| --- | --- | --- | --- | --- |
| Wert 2025 | `monatsmittel` | 2.1818 | – | nur heutige Quelle |

Die übrigen 2 Felder sind gleich.

## Lohn

- Heutige Quelle: Destatis, Index der durchschnittlichen Bruttomonatsverdienste ohne Sonderzahlungen, Jahre, https://www.destatis.de/DE/Themen/Arbeit/Verdienste/Verdienste-Branche-Berufe/Tabellen/index-brutto-monatsverdienst-jahr-erbbau.html, Abruf 2026-11-17, Stand 10. März 2026.
- Original: Destatis, Index der durchschnittlichen Bruttomonatsverdienste ohne Sonderzahlungen, Jahre, 2026-03-10.
- Methode heute: abgerufen: Indexstand und veröffentlichte Veränderung zum Vorjahr für Y und Y−1 aus der Destatis-Tabelle. Methode Original: aus Original: Indexstand und veröffentlichte Veränderung zum Vorjahr aus der festgeschriebenen Destatis-Tabelle.
- Alle 4 Felder gleich.

## Gold

- Heutige Quelle: Weltbank Commodity Price Data (Pink Sheet), Gold, Jahresdurchschnitt; Bundesbank BBEX3 USD/EUR Jahresdurchschnitt, https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Annual.xlsx, Abruf 2026-11-17, Weltbank Updated on September 02, 2026; Bundesbank Stand beim Abruf am 2026-11-17.
- Original: Weltbank Commodity Price Data (Pink Sheet), Gold; Bundesbank BBEX3 USD/EUR Jahresdurchschnitt, Weltbank updated 2026-03-03; retrieved 2026-07-30; Bundesbank retrieved 2026-07-30.
- Methode heute: abgerufen: Weltbank-Jahrespreis Gold und Bundesbank-Jahresmittel USD/EUR für Y und Y−1; Gegenprüfung mit dem Mittel der CMO-Monatswerte. Methode Original: aus Original: Jahresdurchschnitte aus der festgeschriebenen Weltbank-Arbeitsmappe und der Bundesbank-Kursdatei.
- Hinweis des Lesers: Kurs: https://api.statistiken.bundesbank.de/rest/data/BBEX3/A.USD.EUR.BB.AC.A04?startPeriod=2024&endPeriod=2025&format=sdmx_csv&lang=de Gegenprüfung: Mittel der zwölf Monatswerte 3441.50, Abstand 0.01 %.
- Alle 4 Felder gleich.

## CAPE

- Heutige Quelle: Robert J. Shiller, U.S. Stock Markets 1871-Present and CAPE Ratio (ie_data.xls), Blatt Data, Spalte CAPE, https://shillerdata.com/, Abruf 2026-11-17, Daten bis 2026-11, Datei vom 2026-11-16.
- Original: Robert J. Shiller, U.S. Stock Markets 1871-Present and CAPE Ratio (ie_data.xls), Blatt Data, Spalte CAPE, Daten bis 2026-07.
- Methode heute: abgerufen: Dezemberwert des Vorjahres aus der aktuellen Shiller-Arbeitsmappe; nur Auszug, keine Originaldatei. Methode Original: aus Original: Dezemberwert des Vorjahres aus der festgeschriebenen Shiller-Arbeitsmappe; nur Auszug, keine Originaldatei.
- Hinweis des Lesers: Datei: https://img1.wsimg.com/blobby/go/e5e77e0b-59d1-44d9-ab25-4763ac982e53/downloads/249997aa-1eef-4237-93ec-2d319f7881ab/ie_data.xls?ver=1794837439406

| Teil | Feld | heute | Original | Einordnung |
| --- | --- | --- | --- | --- |
| Wert 2024-12 | `cape` | 37.711191696434625 | 37.71119169643465 | Rundungsrauschen |
| Anschluss 2023-12 | `cape` | 31.452310923844557 | 31.45231092384458 | Rundungsrauschen |

## Alte Jahre laut heutiger Quelle

Keine Quelle meldet für frühere Jahre andere Werte als gespeichert.

## Übernahme in der Kopie

- Aktien: Zeile 2025 bytegleich ja, Kette ohne Fortschreibungsblock bytegleich ja.
- Inflation: Zeile 2025 bytegleich ja, Kette ohne Fortschreibungsblock bytegleich ja.
- Geldmarkt: Zeile 2025 bytegleich ja, Kette ohne Fortschreibungsblock bytegleich ja.
- Lohn: Zeile 2025 bytegleich ja, Kette ohne Fortschreibungsblock bytegleich ja.
- Gold: Zeile 2025 bytegleich ja, Kette ohne Fortschreibungsblock bytegleich ja.
- CAPE: Zeile 2025 bytegleich nein, Kette ohne Fortschreibungsblock bytegleich nein.
- Datenmodul bytegleich ja, Inhaltshash `242bd65889bfaecbfcfc399a5e65d1372cc783bfad474c11d47e6805ca5842a4`.

Befunde der Probe:

- CAPE: Zeile 2025 weicht ab
- CAPE: Ketten-Ausgabe ohne Fortschreibungsblock weicht ab
- Inhaltshash 242bd65889bfaecbfcfc399a5e65d1372cc783bfad474c11d47e6805ca5842a4 statt c79350c5abf2dee2feeaae65c88ed5e58487f878cb598fdffc132fbf48d01e79
- Datenstand weicht über Revision und Lieferungen hinaus ab
- Sollwerte tests/fixtures/regime-sollwerte.json weichen ab
- Sollwerte tests/fixtures/live-sollwerte.json weichen ab
