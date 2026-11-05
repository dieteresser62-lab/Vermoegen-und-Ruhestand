# US-Shiller-CAPE als Entscheidungssignal

Die festgeschriebene Arbeitsmappe des Herausgebers liefert die Eingaben für
`UsShillerCapeDecisionChainV1`.

## Quelle und Reihenidentität

| Datei | Reihe / Verwendung | SHA-256 |
| --- | --- | --- |
| `originals/shiller-ie-data-2026-08-01.xls` | Robert J. Shiller, Blatt `Data`, Spalte mit dem konventionellen CAPE | `0e3d716f83f51c14f40c5ab5662e767cde4f83fcb7305db24ab003df2c9ee6c5` |

Ausgewählt wird das konventionelle preisbasierte CAPE des US-Aktienmarkts.
Es ist weder ein Total-Return-CAPE noch eine globale oder deutsche
Bewertungskennzahl. Die Roharbeitsmappe bleibt unverändert. Der Generator
bricht ab, wenn Hash, Tabellenblatt, Abdeckung oder benötigte numerische
Beobachtungen abweichen.

## Zeitkonvention

```text
npm run build:us-shiller-cape-data
npm run verify:us-shiller-cape-data
```

Für das Simulationsrenditejahr `t` wählt der Generator die konventionelle
CAPE-Beobachtung der Arbeitsmappe vom Dezember `t-1`. Das erzeugte Artefakt
speichert diesen Wert unter dem Renditejahr `t` und weist `observationYear`,
`observationMonth`, `asOfYear` und `decisionYear` getrennt aus. Zur Laufzeit
wird der erzeugte Wert für Jahr `t` einmal verwendet. Eine zusätzliche
`previous-year`-Abfrage würde einen falschen doppelten Zeitversatz erzeugen.

Die Kette deckt die Renditejahre 1925–2025 mit Beobachtungen von Dezember 1924
bis Dezember 2024 ab. Der Hash der erzeugten Entscheidungssignale lautet
`d1101958fed64dadf8fba76e9e4e92c8d24e86bd3d21accc42cdb60c247a835f`.
