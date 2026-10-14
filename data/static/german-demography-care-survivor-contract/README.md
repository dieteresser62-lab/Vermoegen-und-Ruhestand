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
  Sterblichkeit.
- Destatis-Pflegequoten sind beobachtete Prävalenzen zu einem Stichtag. Sie
  bleiben ausschließlich für die Validierung erhalten und werden nie in
  jährliche Eintritts- oder Fortschrittswahrscheinlichkeiten umgerechnet.
- Pflegeeintritt, Fortschreiten und Dauer sind separate Modellannahmen.
- Der Hinterbliebenenprozentsatz ist ein vereinfachtes, vom Nutzer gesteuertes
  Zahlungsstrommodell. Er berechnet keinen gesetzlichen Anspruch.

Die Bedingungen zur Quellenweiterverwendung stehen in `LICENSE.md`.
Den vollständigen Vertrag beschreibt `docs/reference/DATA_SOURCES.md`.
