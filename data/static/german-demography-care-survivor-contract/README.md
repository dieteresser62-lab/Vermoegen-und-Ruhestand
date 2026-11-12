# Deutscher Demografie-, Pflege- und Hinterbliebenenvertrag

Die festgeschriebenen amtlichen Quelldateien liefern die Grundlage für die
Rekonstruktion der Demografie- und Pflegebeobachtungen.

## Originaldateien

- `destatis-period-life-table-2023-2025.xlsx`
  - Destatis period life table 2023/2025, Deutschland; jährliche
    Sterbewahrscheinlichkeiten (`qx`) für Männer und Frauen.
  - SHA-256:
    `fbc46083d581e5978c679600875164bcc5af0565a9eb33c57bf33d44ca87aadc`
- `destatis-care-statistics-2023.xlsx`
  - Destatis care statistics zum Jahresende 2023; beobachtete Pflegeprävalenz
    nach Alter und Geschlecht sowie Bestandszahlen nach Pflegegrad.
  - SHA-256:
    `a8088d8e95964c5ffade848b9f303d000dc499519512f66f92ee6b8d60aa4280`

`npm run build:german-demography-data` rekonstruiert aus den Quelldateien
`app/simulator/german-demography-care-survivor-contract.js`. Der Build bricht
ab, wenn Quellenhash, Tabellenidentität, Periode, Geschlecht, Alter oder ein
Markierungswert abweichen.

## Fachliche Grenzen

- Die Sterblichkeitsquelle ist eine Periodensterbetafel. Sie prognostiziert
  keine Kohorte und enthält keine angenommene künftige Verbesserung der
  Sterblichkeit. Seit FR-75 ist sie nur noch Ziel der Pflegeabstimmung und
  Rückfall ohne Geburtsjahr; Laufzeitziel ist die
  [Kohortensterbetafel V2](../../historical/german-cohort-life-table/README.md)
  (`mortality.target`). Die Grundsterblichkeit ohne Pflege wird je Person exakt
  abgesenkt (`care.baseMortalityAdjustment`).
- Destatis-Pflegequoten sind beobachtete Prävalenzen zu einem Stichtag. Sie
  dienen dem Offline-Abgleich und werden nie durch eine Dauer geteilt oder
  direkt als jährliche Eintritts- oder Fortschrittswahrscheinlichkeiten verwendet.
- Pflegeeintritt nach Alter/Geschlecht, Fortschreiten und Sterblichkeitsfaktoren
  sind auf Destatis 2023 abgestimmte Modellannahmen (FR-41), seit FR-75 exakt
  mit `scripts/retune-care-model.mjs` neu abgestimmt, ohne externe Validierung. `scripts/calibrate-care-model.mjs` prüft eine
  Kohorte ab 65 mit beobachtetem Startbestand (60–64 als Näherung: Männer
  4,25 %, Frauen 4,42 %; 22421-02!I46/I68) und den Laufzeithelfern.
  Startgrade folgen den Anteilen aller Alter aus 22421-01. Das Skript erzwingt
  je Geschlecht nicht fallende Eintrittssummen aus Grad 1 und 2. Der Simulator
  startet Personen weiterhin ohne Pflege. Mangels Kreuztabelle Alter × Grad
  in 22421-01/-02 nutzt das Gradziel alle Altersgruppen.
  Dauer bleibt eine separate Modellannahme; aktuelle Gradfaktoren wirken sofort.
- Der Hinterbliebenenprozentsatz ist ein vereinfachtes, vom Nutzer gesteuertes
  Zahlungsstrommodell. Er berechnet keinen gesetzlichen Anspruch.

Die Bedingungen zur Quellenweiterverwendung stehen in `LICENSE.md`.
Den vollständigen Vertrag beschreibt `docs/reference/DATA_SOURCES.md`.
