# Deutsche Kohortensterbetafel V2 (mittel)

Die festgeschriebene Destatis-Arbeitsmappe liefert die Zieltafel der
Lebenserwartung (FR-75): jährliche Sterbewahrscheinlichkeiten (`qx`) je
Geburtsjahrgang 1926–2026, Geschlecht und Alter, Variante V2 „mittel“.

## Erzeugen und prüfen

```text
npm run build:german-cohort-life-table
npm run verify:german-cohort-life-table
```

Der Build schreibt `app/simulator/german-cohort-life-table.js`. Die Prüfung
rekonstruiert das Modul aus dem Original und bricht ab, wenn der Originalhash,
eine Tabellenmarke oder das erzeugte Modul abweicht.

## Quelldatei

| Datei | SHA-256 | Verwendung |
| --- | --- | --- |
| `originals/destatis-cohort-life-tables-1926-2026.xlsx` | `724baa7893854da51dfb2991c5bc03174c046a34e96d6230eb08e5d579504379` | qx V2 Männer (`csv-12621-b03`) und Frauen (`csv-12621-b04`); ferne Lebenserwartung bei 65 aus `csv-12621-b09`/`-b10` als Prüfwert |

Statistischer Bericht „Kohortensterbetafeln für Deutschland 1926–2026“,
EVAS 12621, Artikel 5126101269005, erschienen am 16.09.2026, abgerufen am
12.11.2026 von
<https://www.destatis.de/DE/Themen/Gesellschaft-Umwelt/Bevoelkerung/Sterbefaelle-Lebenserwartung/Publikationen/Downloads-Sterbefaelle/statistischer-bericht-kohortensterbetafeln-5126101269005.xlsx?__blob=publicationFile&v=3>.

## Inhalt und Grenzen

- Destatis rechnet drei Varianten nach der 16. koordinierten
  Bevölkerungsvorausberechnung: V1 niedrig (Trend 2011–2021 bis 2070), V3 hoch
  (Trend 1971–2024 über 2070 hinaus) und V2 als Mittel der qx von V1 und V3.
  Die App nutzt fest V2. V1 und V3 liegen bei der Lebenserwartung ab 60 rund
  ein halbes Jahr darunter oder darüber.
- Das Modul enthält die Alter 18–99. Die Quelle führt „100 und mehr“ mit
  qx = 1. Ab 100 nutzt die Laufzeit den bisherigen Tafelschwanz der
  Periodentafel, skaliert mit dem Verhältnis der beiden Tafeln bei 99; 110 bleibt
  das letzte Alter. Das steht im Demografievertrag (`mortality.tailAssumption`).
- Jahrgänge vor 1926 nutzen 1926, spätere 2026. Divers ist das ungewichtete
  Mittel von Männern und Frauen, keine amtliche Tafel.
- Ab dem Berichtsjahr sind die Werte Vorausberechnung, keine Beobachtung.

Die Bedingungen zur Weiterverwendung stehen in `LICENSE.md`.
