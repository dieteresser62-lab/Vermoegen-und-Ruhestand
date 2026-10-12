# Changelog

## 2026-10-11

### Geändert
- Simulator zeigt beide MC-Kernantworten oben neben dem Backtest; Abdeckungsdetails stehen im bestehenden ⓘ und die drei Backtestkennzahlen sind kompakter. Personenreiter stehen vor den Karten, Haushalt & Plan bündelt Vermögensübersichten und Plananfang; Person & Einkommen beginnt geöffnet, mit Depot-Sprung im Kopf. Verlaufsmetadaten sind über eindeutige ⓘ zugänglich, Qualitätswarnungen bleiben sichtbar.
- Übersicht beginnt mit Fokus und Kennzahlen für Vermögen, Monatsbudget und Plan; der eigenständige Verlauf ist 294 px hoch. Erledigte Abschlussschritte sind aufklappbar, der bestehende Startknopf steht im Kartenkopf. Balance verdichtet Budget/Handlung und Reiterabstände, mit Hilfe als Symbolzugang. Plan-/Vorschauwerte, Abschlusswege und vollständige Detailinformationen bleiben erhalten.
- Profil- und Seitenstatus stehen einmal im kompakten Suite-Kopf; bestehende Umfangs-, Kurs-, Budget- und Sicherungswege bleiben erreichbar. Seitenkopfaktionen stehen zur Titelzeile, Ausgaben und Daten & Sicherung behalten ihre Bereichsfolge.
- Gescheiterte Balance- und Vollimporte zeigen bereits angelegte Wiederherstellungspunkte sofort, bei erhaltener Fehlermeldung. Historische Backtests verwenden nach vollständigem Verkauf das aktuelle leere Inventar statt der Starttranchen. Wirksame Haushaltswechsel invalidieren Ergebnis und Exporte schon vor der Planinitialisierung und auch bei ungültigen Personendaten.
- Jahresprotokolle zeigen „Niedrige Entnahme“ ausschließlich an der Entnahme mit erklärtem CaR-Hinweis und nur bei zugehöriger endlicher Schwelle. Aktien-, Gold- und Bondverkäufe sind neutral, Käufe bleiben hervorgehoben; Rohdaten und JSON-/CSV-Downloads bleiben unverändert.
- Die Monatsbudget-Karte erklärt Kürzungen mit einem Warum-Knopf und einer zunächst geschlossenen Treppe der tatsächlichen Monatswirkungen; Anhebungen zeigen Pluswerte. Der Grundchip nennt die strukturelle Kürzungsregel, die Marktphase steht in der Marktkarte. Ungekürzte gültige Budgets zeigen Vollfinanzierung ohne Treppe; jede neue Berechnung schließt die Ansicht ohne Speicherung.
- Die Engine liefert auf ausdrückliche Anforderung einen rein lesenden Flex-Trace mit tatsächlichen Raten und vorzeichenbehafteten Monatswirkungen einschließlich Mindest-Flex, Safety/Notlage und Floor-geschützter Rundung; bestehende Simulator-/Worker-/Exportaufrufe erzeugen keinen Collector, unbegrenzte Diagnosekennzahlen werden als null abgebildet. Fachwerte, Zustand und Exporte bleiben unverändert.
- Beispielimporte verwenden in Ausgaben, Abschlussdialogen und Startseite kompakte Kopiersymbole mit vollständigen Tooltips; der Sammelknopf heißt „Beispiele für alle“.
- Der Leistenknopf steht auf allen sieben Seiten direkt über Übersicht in der Seitenleiste, auch im kompakten Zustand.
- Abschlussdialoge behalten Teilimporte geöffnet, zeigen Teilbeträge im Budget und geben den Hauptknopf erst nach den erforderlichen Besuchen und Bestätigungen frei.
- Die Jahresvorbereitung hat sechs Schritte. Nach dem Speichern folgen sofort die verbindliche Handlungsanweisung, der Planstand und die Monatszusammenfassung; Monatsretry und getrennte Wiederherstellungspunkte bleiben erhalten.

## 2026-09-24

### Geaendert
- Der Desktop-Build ist plattformneutral: `npm run build:desktop` fuehrt `npm run sync-dist` und `npm run tauri:build` aus. `scripts/sync-dist.mjs` (Node statt PowerShell) baut `dist/` ausschliesslich aus einem Git-Commit und kopiert nur Laufzeitdateien (`app/`, `engine/`, `workers/`, `types/`, `css/`, `assets/` sowie die HTML-, JS- und CSS-Dateien im Wurzelverzeichnis); `data/`, Dokumentation, Tests und Agentendateien gelangen nicht mehr in die EXE.
- Die Browser-Variante startet ueber `scripts/serve.mjs` (`npm run serve`, unter Windows `start_suite.cmd`): Webserver und Yahoo-Proxy laufen in einem Node.js-Prozess und enden gemeinsam. Node.js ist fuer die Browser-Variante damit Pflicht.

### Entfernt
- `RuheStandSuite.exe` und die versionierten Teile von `node_modules/` liegen nicht mehr im Repository; die EXE wird lokal gebaut, aeltere Staende werden ausserhalb archiviert.
- `build-tauri.bat`, `scripts/build-tauri.ps1`, `scripts/sync-dist.ps1`, `start_suite.ps1` und `stop_suite.cmd` sowie die ungenutzten Dateien `app_code.js` und `assets/images/retirement_hero_illustration.png`.

### Tests
- `runtime-build-provenance.test.mjs` prueft Dist-Sync und lokalen Server plattformunabhaengig in einem Git-Fixture; bisher lief der Test nur unter Windows.
- Der neue `dist-runtime-inventory.test.mjs` verfolgt die statischen Verweise der HTML-Einstiege und schlaegt fehl, sobald eine referenzierte Datei nicht nach `dist/` kopiert wuerde.

## 2026-08-17

### Geaendert
- Der Monte-Carlo-Bereich ist als Ergebnis-Cockpit neu geordnet: kompaktes Setup, sichtbarer Laufkopf, fuenf tastaturbedienbare Ergebnisansichten und ein dreistufiges Stresspfad-Replay.
- Szenarioauswahl und Replay liegen in einem gemeinsamen, eindeutigen Arbeitsbereich; programmatische Fokuswechsel aktivieren zuerst die sichtbare Zielansicht.
- Der Replay-Vergleich bietet umschaltbare Kennzahlen-, Delta- und Jahresansichten sowie je Alternative hoechstens eine priorisierte Kernaussage. Diese Darstellung ist weder Variantenranking noch Finanzempfehlung.
- Responsive Layouts und die Druckansicht zeigen Setup, Ergebnisbereiche und Replay-Vergleich ohne fachliche Aenderung an Monte-Carlo-, Engine-, Persistenz- oder Exportvertraegen.

### Tests
- Fokussierte Cockpit-Contracttests und erweiterte Browser-Smokes decken ARIA-Tabs, Tastatur/Fokus, asynchrone Replay-Wechsel, responsive Viewports und Print-Emulation ab.

## 2026-02-15

### Neu
- Verlustverrechnungstopf als jahresübergreifender Zustand (`lastState.taxState.lossCarry`) in Engine, Balance und Simulator integriert.
- Jahres-Settlement als zentrale Steuerwahrheit eingeführt (`engine/tax-settlement.mjs`).
- Simulator-Notfallverkäufe in Gesamt-Settlement-Recompute eingebunden.
- UI-Erweiterungen:
  - Balance zeigt finale Settlement-Steuer sowie Aufschlüsselung (vor/nach Verlusttopf, Ersparnis).
  - Simulator-Dashboard zeigt `Ø Steuerersparnis Verlusttopf`.

### Technisch
- `action.steuer` ist nun die finale Settlement-Steuer (kann von `sum(quellen[].steuer)` abweichen).
- Raw-Aggregate (`taxRawAggregate`) werden für Core-/Simulator-Settlement explizit geführt.
- Build-Härtung: `build-engine.mjs` unterstützt Strict-Mode (`ENGINE_BUILD_STRICT=1` oder `CI=true`), der ohne `esbuild` fehlschlägt.
- Dokumentation vollständig nachgezogen (inkl. `docs/reference/ARCHITEKTUR_UND_FACHKONZEPT.md`, `docs/reference/WORKFLOW_PSEUDOCODE.md`, `tests/README.md`, `Handbuch.html`, `README.md`, `docs/README.md`).

### Tests
- Neue/erweiterte Tests für Settlement, Core-Integration, Simulator-Recompute, MC-Determinismus und UI-Rendering.
