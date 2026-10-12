# Ruhestands-Planer Testing Infrastructure

Die Abschlussdialoge werden gezielt mit `close-dialog`, `overview-month-confirmation`,
`overview-close-dialog-import`, `overview-annual-close`, `balance-close-coordinator`,
`balance-month-year-close-integration` und `annual-close-result` geprüft. Die Ergebnisprüfung
sichert unmittelbare Belegaktion, Scope/Jahr, Inflationsanzeige und Reihenfolge schreibfrei ab.
Die Importprüfung verwendet den produktiven CSVbinder für zwei Personen in Monat und Jahr.
Alte Browserprüfungen zu Schritt 7, letztem Weiter und `annualShowAction` entfallen, weil diese
Zwischenansichten entfernt sind; keine neuen Browserregistrierungen. Browser-Smoke extern,
volle Suite im orchestrierten Lauf ausschließlich durch den Orchestrator.


## Fehlimporte, Kleinstlot und Haushaltswechsel

Gezielt über `node tests/run-single.mjs <datei>`:
`data-import-recovery-refresh.test.mjs` bedient die echten Importbinder und den
Modell-/Renderpfad mit synthetischen Finanzrohstrings. Die Vollimportfälle starten
die produktive Daten-Seite über `initDataPage`, einschließlich Importbinder und
`overview-backup-changed`-Empfänger, ohne einen eigenen Refreshlistener.
Sichtbare Archiv-ID, bestätigter Rollback, ursprüngliche Fehler sowie schreibfreier
Abbruch bleiben geschützt; der Ereignisrefresh bewahrt Hauptmeldung und technische
Ursache und erzeugt keine zusätzlichen Fachwrites.
`simulator-small-lot-backtest-regression.test.mjs` führt echte historische Kurzläufe,
Verkauf/Folgeinventar und sieben vollständige Vorher-Finanzprojektionen per
`JSON.stringify`-Bytevergleich aus. Die neue Fixture stammt vom unveränderten
Ausgangscode und wird nur gelesen. `simulator-household-context-regression.test.mjs`
prüft zusätzlich den offenen Planwartepunkt und bereits ungültige Personendaten;
frühe Invalidierung startet keine Rechnung mit Teilinputs. Das gepinnte
`simulator-backtest-characterization.test.mjs` bleibt auf Linux ausgeschlossen.
Keine neuen Browserfälle oder Detailassertionen; Browser-/EXE-Abnahme bleibt extern.
Die volle Suite (`npm test`) führt im orchestrierten Lauf der Orchestrator aus;
Ergebnisse und externe Prüfpunkte stehen in `docs/internal/fehler-vor-produktivsetzung-belege.md`.

## Kompakte Hauptansichten

`p21-kompaktheit` baut ein kleines DOM aus dem tatsächlichen Startseitenmarkup.
Es prüft Monat/Jahr/play/start, eindeutige offene/erledigte Schritte und Anzahl,
Aufklappen über Refresh ohne Fachwrites, den einmaligen Abschlussstart im Kopf,
Kennzahlenherkunft und erhaltene Balance-/Hilfeziele. Zusätzlich prüft es die
Personenreiter vor den Karten, Haushalt/Plan im bestehenden Panel, den einzigen
Depot-Sprung und beide MC-Kernantworten vor den Deckungsdetails.
`simulator-result-overview` sichert Abdeckung im bestehenden ⓘ, unveränderte
Antwortwerte/Veraltetstatus und den einmaligen Klick-/Startvertrag.
`tranchen-history-ui` prüft Originalmessbasis/-zeitraum, eindeutige Infozugänge
und sichtbare Qualitätswarnungen; Managerproben behalten Reiter-/Öffnen-/Depot-,
Speicherabbruch-, Validierungs- und Bytevergleiche. Die vorhandene Sitzungserinnerung
hat Vorrang vor der anfangs offenen Person-&-Einkommen-Karte. `overview-ui` erhält die
Lead-/Link-, Werte-, Abdeckungs- und Zeitraumprüfungen; die Geometrieprobe zeichnet
auf 292 px gemessener Innenhöhe bei 294 px CSS-Außenhöhe. `designsystem-start-handbook`
prüft dieselben Jahresfarben an den neuen Zeilen statt den entfernten Chips.
Gezielte Läufe über `node tests/run-single.mjs tests/<name>.test.mjs`;
volle Suite ausschließlich durch den Orchestrator. Keine neuen Browser- oder Druckprüfungen.

## Overview

This directory contains the comprehensive testing infrastructure for the Ruhestand-App-Final project. The tests are designed to be zero-dependency, using native Node.js ESM and a custom test runner, avoiding the need for heavy frameworks like Jest or Mocha.

**Test-Statistik:** 169 entdeckte Testdateien mit 19.382 von 19.382 erfolgreichen Assertions, 0 fehlgeschlagenen Dateien, einem bestandenen separaten Gate und 0 offenen Handles (Slice-03-Reviewkorrektur mit `npm test` am 2026-08-07 verifiziert). Das separate Browser-Pflichtgate bestand im Wiederholungslauf nach einem transienten lokalen Windows-Socketfehler mit 29/29 Workflows einschliesslich der responsiven Exaktwert-Fixture, sichtbarer langer Kartentitel und der vollstaendigen realen Simulatorseite nach einem Lauf bei 320 Pixel. Der letzte gesonderte Coverage-Lauf stammt aus der Slice-13-Nachbesserung und erreichte 78,97 Prozent Zeilenabdeckung (40.302/51.035); Coverage wurde fuer Slice 03 nicht erneut gemessen.

Die Zahl beschreibt nur die Node-Standardsuite. `npm run test:browser`, `npm run test:coverage` und ein echter Tauri-Build sind getrennte Gates und in den Assertions nicht enthalten.

## Directory Structure

- `run-tests.mjs` - Der benutzerdefinierte Test-Runner
- `run-single.mjs` - Führt eine einzelne Testdatei aus
- `legacy-assertion-loader.mjs` - Zaehlt in explizit benannten Alt-Tests lokale bzw. Node-Assertions ueber den gemeinsamen Runner-Contract
- `*.test.mjs` - Testdateien (werden automatisch vom Runner erkannt)

## How to Run Tests

### Standard-Suite
```bash
npm test
```

`npm test` fuehrt die schnelle Node-Standardsuite ueber `node tests/run-tests.mjs` aus. Die Suite enthaelt DOM-freie Engine-, Balance-, Simulator-, Profil-, Tranchen-, Persistenz-, Worker- und Tauri-Contract-Tests. Browser-Smokes und echte Tauri-Builds sind separate Gates.

Die optionale Tranchenkurszeit `asOf` wird in `tranche-contract.test.mjs` und
`tranchen-manager-state.test.mjs` auf V0-/V1-/V2-Kompatibilität, strikte UTC-Sekunden
und Save/Load geprüft. Modal- und Pagetests decken Zeitverlust bei manueller
Kurs-/Instrumentänderung, Erhalt bei Notiz-/Anteils-/Steueränderung, Kaufpreis-Fallback,
Wiedereintragen früherer Preise sowie den echten Kurslistener mit gleichem Preis,
geteiltem Symbol, Teilfehler, Profilwechsel/Abbruch und Flush-Rollback/Retry ab.
Profil-/Persistenztests sichern Bundle-/Vollbackup-Roundtrips, Profilwechsel und
Importablehnung vor Writes einschließlich inaktiver Profile. Profilverbundtests
erhalten reale Preis-/Zeit-/Eigentümerzuordnung und undatierte synthetische Aggregate.
Der externe Tranchen-Browser-Smoke prüft die exakte Quotezeit im bestätigten
IndexedDB-/Registrystand, Notizänderung, Reload und manuelle Preisänderung.

Das statische Architektur-/Fachkonzept-Evidenzgate ist Teil dieser Suite und
kann zusätzlich fokussiert ausgeführt werden:

```bash
npm run docs:evidence
```

Der Befehl prüft die normativen Markt- und Forschungsregister ausschließlich
lokal auf Recordzahlen, Pflichtfelder, IDs, Anker, lokale Links,
ISO-Datumsfelder und fällige Aktualitätsscopes. Er führt keine Live-HTTP-
Prüfung durch; externe Erhebungen bleiben ein getrennt dokumentierter
Pflegeschritt.

Der Runner sortiert alle Dateien deterministisch und verteilt sie auf einen Prozesspool. Standard ist `max(1, os.cpus().length - 4)`; `TEST_WORKERS=8 npm test` begrenzt die Last, `TEST_WORKERS=1 npm test` führt dieselben isolierten Dateien seriell aus. Im Normalmodus erscheint je Datei genau eine Ergebniszeile mit Datei, Modus, Assertionzahlen, Dauer und Status; separate Gates nennen zusätzlich Befehl und Grund. Bestandene Einzelprüfungen und Logs grüner Dateien bleiben verborgen. Rote Dateien zeigen ihre fehlgeschlagenen Prüfungen mit Meldung und den ersten sechs Stackzeilen; bei hartem Abbruch ohne IPC werden die ersten acht Zeilen der Fehlerausgabe (ersatzweise der Dateiausgabe) gezeigt. Nach Zusammenfassung, Gesamtdauer und den zehn langsamsten Dateien folgt zuletzt eine kompakte Liste aller roten Dateien mit ihren Fehlerdiagnosen. `TEST_VERBOSE=1 npm test` zeigt sämtliche Einzelprüfungen und gepufferten Dateilogs zusammenhängend. Direkte Aufrufe mit `node tests/run-single.mjs <datei>` bleiben immer ausführlich. Assertionzahlen und Exit-Code sind in beiden Modi gleich. `--isolated` und `TEST_ISOLATED=1` bleiben kompatible Aufrufe, Isolation gilt jetzt immer. Die Ausfuehrungspolicy steht explizit in `TEST_EXECUTION_POLICY`:

- `isolated`: Jede Datei läuft in einem eigenen Kindprozess; dessen Assertionzahlen gehen über einen getrennten IPC-Kanal in die Gesamtsumme ein. Legacy-Assertion-Instrumentierung bleibt dateispezifisch.
- `serial`: Nur nachgewiesene gemeinsame Ressourcen rechtfertigen diesen Modus mit Begründung in der Policy; diese Dateien laufen nach dem Pool nacheinander. Aktuell ist keine Bestandsdatei dafür eingetragen.
- `separate-gate`: Nicht zur aktuellen Laufzeit passende Gates werden nicht still importiert, sondern mit ihrer Pflichtumgebung und dem dort auszufuehrenden Befehl ausgewiesen. Dazu gehoeren der Browser-Smoke sowie unter WSL das echte Windows-Poppler-Gate und bytegenaue Windows-x64-/Node-v25.2.1-Evidenzmessungen.

Unter Windows x64 mit Node v25.2.1 fuehrt `npm test` die beiden bytegenauen
Evidenzmessungen direkt aus. Der mit Poppler 25.07.0 gepinnte
Cash-/Geldmarkt-PDF-Oracle laeuft auf jeder Windows-Node-Version. Unter
WSL/Linux erscheinen diese drei Dateien als separate Gates;
die uebrigen fachlichen, Engine-, FlowDelta- und Portabilitaetsvertraege der
Standardsuite bleiben aktiv.

Jede tatsaechlich ausgefuehrte Datei muss mindestens eine gezaehlte Assertion liefern. Null Assertions beenden sowohl `npm test` als auch `run-single.mjs` mit Fehler. Der Legacy-Loader gilt nur fuer die im Policy-Manifest benannten Dateien; unbekannte Import-only-Tests erhalten keinen stillen Ausnahmeweg.

Der Slice-16-Integrationscontract liest alle Inputs im realen
Sweep-Ranges-Fieldset generisch und gleicht jeden sichtbaren Parameter
fail-closed mit der Traceability-Matrix ab. Witness-Gates werden gegen
`TEST_EXECUTION_POLICY` geprueft. Die Matrix belegt kanonische Zuordnung,
Consumer und Provenienz, nicht eigenstaendig eine KPI-Wirkung.

### Funktionsinventar: Schutzgate und Pflege

[`funktionsinventar.test.mjs`](funktionsinventar.test.mjs) wird als `*.test.mjs`
automatisch in `npm test` entdeckt und meldet gezählte Assertions. Der Test aktiviert einen ausschließlich pro Prozess und Testlauf geltenden Quellprüfungs-Cache: unveränderte Erzeugerbelege und Funktionsbindungen werden einmal gescannt, geänderte/fehlende Quellen und geänderte Belegargumente erneut geprüft. Alle Bestands-, Mutations- und Grenzfälle bleiben erhalten. Es gibt
keinen zusätzlichen Pflichtaufruf außerhalb dieser Suite. Der Test prüft
Schema 2 und Pflichtfelder, eindeutige Eintrags-/Befundkennungen, typisierte
Definitionen und Referenzzyklen, das Register der 162 Ausgangskennungen,
statische Elemente und Delegationshosts, dynamische Erzeugerorte und Anker,
Code-/Erzeuger-/Initialisierungs-/Schreib-/Befund-/Testdateien, konkrete
Node-Testbelege und tatsächlich registrierte Browserfälle. Außerdem muss
die Lesefassung exakt aktuell sein. Die inklusiven UTF-8-Bytegrenzen sind
1.500.000 B für die JSON-Quelle, 225.000 B für Markdown und 20.000 B je
kompakt serialisiertem, aufgelöstem Eintrag (Nutzerentscheidung vom 06.10.2026). Exakt am Grenzwert ist gültig;
ein Byte darüber scheitert. Jede Quellzeile hat höchstens 2.000
Unicode-Zeichen. Etwa 800.000 B für die Quelle sind ein Planungsziel,
kein zweiter harter Grenzwert. Referenzen verbergen keine Eintragsübergröße;
Neuerzeugung allein behebt weder eine zu große Quelle noch einen zu großen Eintrag.
Injizierte Quellkopien sichern diese Gates mit Fehlerfällen ab; sie ändern
keine Produktdateien und starten weder App noch Browser.

Die [JSON-Quelle](../docs/design/funktionsinventar.json) enthält alle
Detailprüffälle, Speicherverträge und das historische Register. Dessen
Zuordnungen auf aktuelle Kennungen sind erlaubte Referenzen, keine
Kennungsduplikate. Die [Lesefassung](../docs/design/funktionsinventar.md)
zeigt die Übersicht und die getrennten Listen „Änderungsrisiko“,
„Testschuld“ und „Prüfergrenzen“ in der Reihenfolge des Fahrplans.

Aktuelle Eintrags- und Belegzahlen stehen ausschließlich in der erzeugten
[Schutzstatistik](../docs/design/funktionsinventar.md#dynamische-schutzstatistik).
Der Status wird pro dynamischem Beleg gezählt, nicht pro Funktion. Die Arten
„ungeschützt (Anker fehlt)“ und „ungeschützt (Erzeugungsform vom Prüfer nicht unterstützt)“
prüfen weiterhin Datei und beschriebenen Ort. Letztere verlangt zusätzlich
einen lexikalischen Anker am Ort.
Sie beweist damit keine Erzeugung; ein Listener, Leser oder Kommentar
ersetzt keinen geschützten Erzeuger. Dynamische Delegationshosts benötigen
einen eigenen Beleg und gegebenenfalls ein eigenes Änderungsrisiko.
Ein verschwundener geschützter Erzeuger erzeugt einen Fehler und wird
niemals automatisch herabgestuft.

Geschützte Belege brauchen den vollständigen Selektor und ihren eigenen
Anker am selben erzeugten Element; ein Eltern-/Nachbaranker genügt nicht.
Ein Data-Anker ohne `value` prüft Attributpräsenz, auch bei berechnetem
oder leerem Wert. Ein explizites `value` bleibt eine exakte Wertanforderung.
Delegierte Codebezüge nennen mit `delegates` die tatsächlichen Ereignisfelder,
keine Hosts oder direkt gebundenen Nachbarcontrols: alle statischen Treffer
liegen unter `ancestor`, dynamische Felder folgen ihren inventarisierten
`host`-Ketten. `functions` enthält alle einzelnen benannten Definitionen
oder echten lokalen Importbindungen des Moduls; leere Listen verlangen
`nonFunction` mit `structure`, `style`, `native` oder `anonymous-event`
und einem konkreten Grund. Die bestehende Beschreibung `function` bleibt
erhalten. HTML-Codebezüge kennzeichnen mit `functionOrigin` die tatsächliche
Herkunft `inline-module` oder `inline-classic`; dynamische HTML-Erzeugerbelege
nennen ihren konkreten Scriptblock. Kommentare, Strings und bloße Aufrufe genügen nicht.

`sourceRevision` ist dauerhaft die Anwendungscode-Basis
`0e39685f2d01c4964e2f64c9bbad69e22afea4a1` vor der Design-Grundlage,
nicht der aktuelle Inventarcommit und keine Behauptung über ein dort
vorhandenes Inventar. Das historische Register stammt aus der ersten
Inventarerhebung (`d0418d2` bis `db728d0`); seine Zuordnungen bleiben in
`baselineAudit` unabhängig nachvollziehbar. `0f4ebce` ist der Fortsetzungsstand
vor der Nachschärfung. Der Schutztest benötigt keinen Live-Git-Zugriff.

Der Aufruf `node tests/funktionsinventar.test.mjs` ist kein eigenständiger
Prüflauf: der Test braucht die Assertion-Globals des Runners. Er wird über
`node tests/run-single.mjs tests/funktionsinventar.test.mjs` oder `npm test`
ausgeführt. Bestandsassertions reichen die Vertragsdiagnosen mit Istwert,
Grenze beziehungsweise erwarteter Größe und Abhilfebefehl an den Runner durch;
gleiche Bytezahl ersetzt keine Inhaltsprüfung der Lesefassung.

Das begrenzte lexikalische Gate importiert keinen Anwendungscode. Es beweist
weder den Laufzeitaufruf noch das Anfügen an den DOM, die eindeutige Zuordnung
wiederholter Ankerwerte, Bedienung, Optik oder fachliche Semantik. Auch
Definitionen/Importbindungen beweisen weder Aufrufbarkeit zur Laufzeit
noch unveränderte Funktionskörper. Lokale Anfügebeziehungen liefern nur
begrenzten statischen Selektorkontext. Die inventarisierten
Node-/Browser-Prüffälle bleiben dafür nötig. Nicht
unterstützte Erzeugungsformen sind konkrete Prüfergrenzen, keine
automatische Aufforderung zum Umbau der App.

Pflegefolge für spätere Pakete:

1. Vor dem Umbau betroffene Kennungen, Delegationshosts und konkrete
   Änderungsrisiken bestimmen. Unberührte Testschuld wird nicht vorgezogen.
   Risiken zu Paket 1/2 benennen Verhalten und Änderungsauslöser; generische
   spätere Gründe tragen exakt „vorläufig – wird in der Paket-Idee eingeordnet“.
   Konkrete Gründe, Evidenzen und Befundbezüge bleiben erhalten. Jedes
   Lückenpaket gehört zu `[target.firstPackage, ...target.laterPackages]`.
2. Bei „Anker fehlt“ zuerst im App-Scope des tatsächlich umbauenden Pakets
   ein stabiles `data-*` ergänzen, Beleg und Bediennachweis aktualisieren
   und erst nach bestandenem Erzeugungsnachweis auf „geschützt“ umstellen.
   Nicht unterstützte Formen separat prüfen und die konkrete Grenze
   beibehalten; ein Statuswechsel darf keinen Fehler verdecken.
3. Bei Umbenennung oder Verschiebung die JSON-Quelle einschließlich
   Selektor, eigenen Elementanker, Erzeugerort, Ausgangszustand mit konkretem
   Grund, `host`/`ancestor`/`delegates`, `functions`/`nonFunction`, Testbezug
   und Lückenbegründung aktualisieren. Neue Funktionen mit Prüffällen,
   Speicherverträgen und Belegen additiv eintragen; neue Befunde mit
   Quellen- und Kennungsbezug ergänzen. Keine festen aktuellen Zählwerte
   nachziehen; gültige Folgeänderungen bleiben regulär prüfbar. Ein reiner
   Beschriftungswechsel bei unverändertem Anker braucht keine Code-Wortlautkopie.
4. Mit `node scripts/generate-funktionsinventar.mjs` neu erzeugen.
   Markdown wird nicht von Hand gepflegt.
5. Fokussiert prüfen:

   ```bash
   node tests/run-single.mjs tests/funktionsinventar.test.mjs
   node tests/funktionsinventar-contract.mjs --self-test
   node tests/funktionsinventar-contract.mjs --check
   node scripts/generate-funktionsinventar.mjs --check
   ```

Die volle Suite führt im orchestrierten Lauf der Orchestrator aus.
Für dieses reine Inventarpaket ist kein zusätzlicher Browser-Smoke
erforderlich; das allgemeine Browsergate vor dem späteren Merge bleibt
Aufgabe der Steuerung.

### Engine-Wrappervertrag

`engine-wrapper-contract.test.mjs` wird automatisch von `npm test` entdeckt
und prüft mit einer gezählten Assertion den vollständigen Inhalt von
`engine.js` gegen einen unabhängig festgelegten Solltext. Geschützt sind
der direkte Import aus `engine/index.mjs`, die Browser-Globals und die
Exporte einschließlich des Legacy-Alias. Ausschließlich CRLF wird zu LF
normalisiert; zusätzliche Anweisungen oder andere Inhaltsänderungen
werden abgewiesen. Der Dateipfad wird aus `import.meta.url` abgeleitet,
sodass die Prüfung unabhängig vom Arbeitsverzeichnis erfolgt.

```bash
node tests/run-single.mjs tests/engine-wrapper-contract.test.mjs
```

Die Prüfung liest nur den Wrapper und benötigt weder Build noch Bundler,
Netz oder Browser. Ein echtes Bundle scheitert bewusst, auch wenn es
frisch erzeugt wurde oder zusätzlich zum vollständigen Wrapper angehängt
ist. Ein bewusster Bundlewechsel benötigt eine eigene geprüfte Änderung
des Schutzvertrags mit einem nachvollziehbaren Aktualitätsnachweis;
der Test darf dafür nicht still abgeschwächt oder übersprungen werden.
Änderungen hinter demselben Modulimport erfordern für diese Prüfung
keinen Neuaufbau von `engine.js`.

### Coverage-Baseline
```bash
npm run test:coverage
```

Der Coverage-Runner loescht `.coverage/`, startet die Standardsuite mit `NODE_V8_COVERAGE` und schreibt bei gruener Standardsuite `.coverage/summary.json`. Der Report wertet Projektdateien unter `app/`, `engine/`, `workers/` und `types/` aus. Die Messung nach der CR08-16-Nachbesserung liegt bei 78,23% approximativer Coverage aus ausfuehrbaren V8-Zeilenbereichen (39.024/49.886 Zeilen in 216 Dateien). `npm run test:coverage` erzwingt zusaetzlich ein 50-Prozent-Dateigate fuer `worker-job-runner.js` und `results-renderers.js`; ein fehlender Inventareintrag oder eine Unterschreitung beendet den Lauf rot. Playwright-Ausfuehrung fliesst nicht in diese Node-V8-Zahl ein. Der durch den neuen DOM-Vertrag teilweise in Node ausgefuehrte Orchestrierungspfad `app/simulator/simulator-sweep.js` erreicht dort 6,50%; Browseranteile bleiben ausserhalb dieser Messung. Coverage bleibt eine Risikomessung, kein Freigabe-, Wirksamkeits- oder Eignungsnachweis und insbesondere keine echte JavaScript-Statement-Metrik.

Monte-Carlo-Abschlussgate in Slice 12:

| Modul | Zeilen | Coverage |
| --- | ---: | ---: |
| `worker-job-runner.js` | 147/217 | 67,74% |
| `results-renderers.js` | 117/117 | 100,00% |

Backtest-Kernmodule im Slice-10-Abschlussgate:

| Modul | Zeilen | Coverage |
| --- | ---: | ---: |
| `historical-backtest-contract.js` | 604/779 | 77,54% |
| `historical-backtest-runner.js` | 545/610 | 89,34% |
| `historical-backtest-metrics.js` | 202/215 | 93,95% |
| `historical-backtest-cohorts.js` | 242/294 | 82,31% |
| `historical-backtest-export.js` | 205/267 | 76,78% |
| `historical-backtest-ui.js` | 265/327 | 81,04% |
| `simulator-backtest.js` | 225/313 | 71,88% |

Das Coverage-Inventar fuehrt zentrale Tranchenmodule auch bei 0% sichtbar auf und markiert einen geladenen, aber nicht ausgefuehrten Page-Pfad als `runtime-loaded-uncovered`. `app/tranches/tranchen-manager-page.js` ist im aktuellen Node-Coverage-Lauf mit 66,51% (844/1269 Zeilen) erfasst; der separate Browser-Smoke bleibt fuer echte DOM- und Navigationspfade erforderlich.

Bekannte Coverage-Ausnahmen:
- UI-nahe Renderer und Page-Module koennen trotz Browser-Smoke in der V8-Zeilenmetrik niedrig oder 0% erscheinen, wenn ihre Logik nur ueber echte Browserinteraktion relevant ist.
- Wrapper-/Re-Export-Module wie `engine/index.mjs` koennen niedrige Werte zeigen, obwohl die dahinterliegenden Kernmodule abgedeckt sind.
- Dateien ohne ausfuehrbare Zeilen werden mit `coveragePct: null` ausgewiesen und nicht als 100%-Abdeckung interpretiert.

### Browser-Smoke-Gate
```bash
npm run test:browser
```

Das Browser-Gate nutzt Playwright mit einem vom Test verwalteten lokalen HTTP-Server. Jeder Fall erhaelt einen isolierten Browser-Context und eine eigene Storage-Baseline. Neben den zentralen Einstiegspunkten (`index.html`, `Balance.html`, `Simulator.html`, `depot-tranchen-manager.html`, `Handbuch.html`) prueft es in `Balance.html` Profilabwahl nach Reload, Engine-Mismatch, mutationsfreien Jahres-Preflight, sichtbare korrupte Ausgaben, sichtbaren Import-Reject, einen Markt-CSV-Roundtrip mit periodengebundener Provenienz/`windowHigh`/sichtbarer gerichteter ATH-Untergrenze samt Anwendungsstatus/Boolean-Reload, einen Doppelklick mit genau einem Jahrescommit und Recovery-Snapshot sowie die 3-Bucket-Bear-Diagnose aus der realen Engine-Rendite. Die Simulatorfaelle warten auf fachliche Statuswerte statt auf feste Millisekunden. Fuer das MC-Ergebnis-Cockpit prueft das Gate die vier vom Haupttab-System getrennten ARIA-Tabs, Roving-Tabindex und Pfeil/Home/End, den Setup-/Laufkopf-Lifecycle, den Szenario-Log-Rueckverweis, asynchrone Fokusreaktivierung und die drei rerenderfesten Replay-Vergleichsansichten. Die abschliessende Responsive-/Printmatrix ergaenzt diese Interaktionen um 320, 768, 900, 1280 und 1600 CSS-Pixel sowie um sichtbares Setup, alle MC-Panels, alle Vergleichssektionen und deaktivierte Navigation/Sticky-Positionierung im Druckmedium. Der Stress-Replay-Workflow prueft ausserdem den echten leeren Startzustand, das native deaktivierte Fieldset, die Fokusansicht aus Name plus drei Bedarfsfeldern, den initial geschlossenen Expertenbereich samt ARIA-/Werterhalt und die deutschsprachige Anzeige des echten Mindest-Flex-Relationsfehlers. Fixieren, priorisierte Kernaussage, Variantenvergleich und getrennte Texte fuer Jahres- und Prozentpunktdeltas bleiben abgedeckt; der Deferred-Promise- und Reentrancy-Nachweis des Busy-Vertrags liegt im separaten `stress-replay-ui.test.mjs`. Der Backtestfall reconciliiert sichtbare Periode, Outcome, Jahrinventar, exakte 10-%-Metrik, Pflegebucket und Cohort-Inventar mit Raw-JSON und deckt die Negativpfade ab. Inflation, Yahoo-Proxy und CAPE werden deterministisch geroutet; andere externe Requests werden blockiert. Das Gate ersetzt keine Node-Unit-Tests und ist fuer Browser-Regressionen ein explizit auszufuehrendes Pflicht-Gate neben `npm test`.

Wichtig fuer CI/Release: Weil `npm test` dieses Gate nicht ausfuehrt, muss `npm run test:browser` explizit als eigener Job oder Release-Schritt laufen, wenn Browser-Regressionen blockierend sein sollen.

Das Meldungsprotokoll in `createPage()` beobachtet getrennt `#error-container`, `#toast-container` und `#action-error-container`. Bei Toasts wird nur `.toast-text`, bei Aktionsfehlern nur `.action-error-text` je `data-scope` gelesen, ohne dekoratives Symbol, Typkennzeichnung oder Schließenbeschriftung. Der Aktionsobserver vergleicht Eintragsidentität und Text je Bereich und protokolliert unveränderte Nachbarfehler nicht erneut. Jahresabschluss und Markt-CSV-Erfolg verlangen einen seit der Aktion neuen Protokolleintrag; die sichtbare Markt-CSV-Erfolgsmeldung wird aus dem Toastkanal gelesen.

Die ausdrücklich zeitbezogenen Meldungsprüfungen lesen zusätzlich die aktuelle sichtbare Oberfläche bei weiterlaufenden Timern: `Balance annual commit` prüft den exakten Jahresabschlusszusatz nach ungefähr 1 s und insgesamt 3 s bei aktivem und inaktivem Verlauf. `Balance import reject` prüft den abgeschlossenen JSON-Reject nach weiteren 2 s. `Balance wealth history` prüft JSON-Ablehnung und echten automatischen Rollback jeweils aktiv/inaktiv nach 2 s sowie nach Tabwechsel und Rückwechsel. Das historische Protokoll allein ersetzt diese Sichtbarkeitsprüfungen nicht. Diese Beschreibung benennt implementierte Assertions, keinen in der Agentensandbox ausgeführten Browserlauf; das Browsergate führt die gesteuerte Sitzung außerhalb der Sandbox vor dem Merge aus.

Die ergänzten Meldungsfälle verwenden synthetische Daten und testseitige Fehlerinjektionen ohne Produkt-Testhooks; Instrumentierungen werden im `finally` zurückgebaut:

- **`Balance import restoration`** startet echte JSON-/CSV-Importhandler mit erfolgreichem Dry-Run und injiziert anschließend JSON-Replacefehler, JSON-Finalvalidierungsfehler mit echtem Rollback oder Markt-CSV-Replacefehler. Vor Ausgabe des Aktionsfehlers und nach Abschluss werden Depotwert, Monatsentnahme, Kurzdiagnose und `#handlungContent` mit der gültigen Baseline verglichen; gespeicherter State, Eingabefelder, Provenienzanzeige, Fehlercode und neuer Meldungsprotokolleintrag werden ebenfalls geprüft. Verworfenes Berechnungsfeedback samt Feldmarkierungen muss verschwinden. Der gesonderte Dateieventfall startet keinen Import: temporärer Dateiinput mit `input`/`change` und reale Dateiinputs mit `input` ergeben null Updates, null `clearError()`-Aufrufe und null entprellte Vormerkungen bei unveränderten Fehlermarkierungen.
- **`Balance folder abort`** klickt den echten Ordnerknopf und kontrolliert einen ausstehenden, danach mit `AbortError` abgebrochenen Auswahl-Promise. Ein bestehender Snapshotfehler bleibt während und nach dem Dialog identisch; fremde Aktionsfehler bleiben erhalten, es entsteht weder eine neue Fehlermeldung noch eine Erfolgsmeldung. Erfolgs- und Fehlerpfade der Verbindung sind zusätzlich in den Node-Tests abgedeckt.
- **`Balance message presentation`** prüft kurze zugängliche Schließenlabels, eindeutige Text-IDs und `aria-describedby`, Fokusübergabe beim Tastatur-Schließen bis zum Diagnoseknopf, wirkungslose veraltete Knöpfe und passive automatische Bereinigung. Der Listencontainer ist nur mit Einträgen eine benannte Tabstation. Tatsächlich errechnete Vorder-/Hintergrundfarben aller drei Toasttypen müssen mindestens 4,5:1 Kontrast ergeben. Bei 1366 und 375 CSS-Pixeln bleiben lange Fehler vollständig, die Listenhöhe höchstens `min(16rem, 30vh)`, vertikales Scrollen per Home/End und alle Knöpfe per Tab erreichbar, ohne horizontalen Überlauf. Druckausblendung und unveränderter Berechnungsfehlerrahmen werden gesondert geprüft.
- **`Balance annual commit`** beobachtet den neutralen Fortschrittshinweis am echten Jahresknopf mit kontrolliert freigegebenem Datenabruf, den Erfolg nach Abschluss sowie den neutralen Perioden-No-op über den zweiten Jahresknopf. Der vorhandene Doppelklicknachweis verlangt weiterhin genau einen Jahrescommit und einen Recovery-Snapshot. Direkte Inflations-/ETF-/CAPE-Aufrufe in Node-Prüfungen sind interne Abläufe; `Balance.html` besitzt dafür keine eigenen Abrufknöpfe.

Der Fall **`Balance wealth history`** betätigt „Stand jetzt erfassen“ auch per Tastatur, prüft den lokalen Tag bei abweichendem UTC-Datum, Profilverbund-/Tranchenwerte, Tagesersetzung und einen weiteren Tag. Er vergleicht alle sichtbaren Tabellenwerte mit dem bestätigten IndexedDB-State, prüft Reload, den echten Profilwechsel über die Startseite, Profilisolation, einen einzelnen Nullstand und Legacy-Import ohne Verlauf. Bei 375 CSS-Pixeln werden alle vier Haupttabs, direkte Fokusfolge ab Capture, interne Scrollregionen und fehlender seitenweiter horizontaler Überlauf geprüft. **`Balance annual commit`** verwendet feste Zeit im Januar 2027 und geroutete Daten für 2026: genau ein `annual:2026` am 31.12.2026 mit erwarteten Beständen, aktive Registrykopie, gesperrte Mehrfachbedienung, Wiederholung über den zweiten Jahresknopf und Reload. Keine Live-Netzabhängigkeit; nur Date ist fixiert, die asynchronen Timer laufen regulär.

Beide Verlaufsfälle importieren `installWealthBrowserUpdateObserver` aus dem eigenständigen Hilfsmodul `wealth-browser-update-observer.mjs`. Produkt und Tests teilen `BALANCE_UPDATE_DEBOUNCE_MS = 250` aus `app/balance/balance-config.js`; `context.addInitScript(installWealthBrowserUpdateObserver, BALANCE_UPDATE_DEBOUNCE_MS)` übergibt die Verzögerung ausdrücklich, ohne freie Modulvariablen im serialisierten Hook. Die Installation erfolgt vor den Seitenskripten, erneut bei jedem Reload und jeder Profilnavigation. Accessors erfassen auch die nachträgliche Zuweisung von `setTimeout` und `clearTimeout` durch `page.clock`. Damit wird der beim Start durch die Tranchen-Synchronisierung geplante Inputupdate vor dem instrumentierten Tabwechsel abgewartet; ein bereits gespeichertes `profilverbundHouseholdInputs` allein belegt keinen abgeschlossenen Neustart. Der Profilverbund-Startuphelfer gilt nur für das Zwei-Profil-Szenario; der Ein-Profil-Jahresabschluss wartet auf beobachtbares Idle.

Das Aktivierungsfenster verlangt unverändert exakt null Aufrufe von `readAllInputs`, `clearError` und `persistenceStorage.setItem`, null `setItem`-/`removeItem`-/`clear`-Mutationen beider Browser-Speicher und identische sortierte Schlüssel sowie vollständige Schlüssel/Wert-Paare von `localStorage` und `sessionStorage`. Fach-, Registry- und Exportvergleiche bleiben erhalten; im `finally` werden alle Instrumentierungen samt Hilfsvariablen zurückgebaut. `balance-wealth-history.test.mjs` importiert nur das Hilfsmodul, keine Browser-Suite, und prüft den serialisierten Hook für Start/Reload, Idempotenz beider Accessors, nachträgliche Timerzuweisung, Callbackargumente, Abbruch, Folgeupdate und Cleanup nach Callbackfehler. Eine abweichende Verzögerung von 417 ms belegt die Parameterbindung; der synthetische 3500-ms-Beispieltimer des Observertests blockiert Idle nicht und beschreibt keine Produktlaufzeit (Balance-Toasts: 6000 ms). Abgesehen von den ausdrücklich zeitbezogenen 1-/3-s- und 2-s-Meldungsprüfungen bleiben Fach- und Idleprüfungen zustandsbasiert.

Gezielte Browserläufe:

```bash
node tests/browser-smoke.test.mjs --only='Balance wealth history'
node tests/browser-smoke.test.mjs --only='Balance annual commit'
```

Im orchestrierten Lauf führt allein der Orchestrator `npm test` aus. Verhindert die Agentensandbox den lokalen Server-/Browserstart (z. B. `listen EPERM`), wird das als nicht ausführbar dokumentiert; `npm run test:browser` bleibt ein separates Gate, das die gesteuerte Sitzung außerhalb dieser Sandbox vor dem Merge ausführt. Ein Syntaxcheck ersetzt keinen Browsernachweis.

### Release-nahe Tauri-Gates
```bash
node tests/run-single.mjs tests/tauri-csp.test.mjs
npm run tauri:build
```

`tests/tauri-csp.test.mjs` ist Teil von `npm test` und prueft Tauri-Konfiguration, CSP, Icons, Package-Skripte und statische Rust-Command-Contracts. Sobald `src-tauri/` geaendert wird, muss zusaetzlich ein echter Tauri-/Rust-Build laufen (`npm run build:desktop`). Manuelle Desktop-Smokes nach EXE-Build bleiben manuelle Release-Verifikation und sind kein Ersatz fuer automatisierte Tests.

Persistenz-Hinweis: `persistence.test.mjs` simuliert IndexedDB-Upgrade-, Blocked-, Legacy-Cleanup- und Versionchange-Pfade ueber Fakes; `balance-storage-contract.test.mjs` prueft die Migration des historischen Verzeichnis-Handles in die dedizierte Handle-Datenbank. Ein echtes Chromium-Szenario mit Datenbank-Version N -> N+1 und realem Schemawechsel bleibt ein separates Browser-/Playwright-Backlog.

### Einzelne Testdatei ausführen
```bash
node tests/run-single.mjs <testfile>
# Beispiel:
node tests/run-single.mjs core-engine.test.mjs
```

`run-single.mjs` verwendet dieselbe dateibasierte Isolations-/Legacy-Assertion-Policy wie die Standardsuite und scheitert ebenfalls bei null Assertions.

### Direkte Ausführung
```bash
node tests/run-tests.mjs
```

`QUICK_TESTS=1` ist deprecated. Fuer schnelle Fehlersuche gezielt `node tests/run-single.mjs <testfile>` oder die im jeweiligen Slice dokumentierten Fokusbefehle verwenden.

## Assertions Available

Die folgenden Assertion-Funktionen werden vom Test-Runner global bereitgestellt:

- `assert(condition, message)` - Prüft ob Bedingung wahr ist
- `assertEqual(actual, expected, message)` - Prüft strikte Gleichheit
- `assertClose(actual, expected, tolerance, message)` - Prüft numerische Nähe

## Writing New Tests

1. Erstelle eine neue Datei mit dem Suffix `.test.mjs` im `tests/`-Verzeichnis
2. Die Assertions sind global verfügbar (vom Runner bereitgestellt)
3. Verwende Standard-ESM-Imports für Module
4. **Mocking:** Da das Projekt auf Browser-Globals (`window`, `document`, `localStorage`) angewiesen ist, müssen diese vor dem Import von Code gemockt werden. Siehe `simulation.test.mjs` für ein umfassendes Beispiel.

---

## Test Coverage Areas

### Neuentwicklungen seit Juni 2026

| Entwicklungsbereich | Direkte Tests | Zusaetzliche Integrations-/Paritaetsdeckung |
|---------------------|---------------|--------------------------------------------|
| Kontinuierliche Regime-Signale | `regime-signals.test.mjs` | `spending-planner.test.mjs`, Engine-/Diagnose-Contracts |
| Kontinuierliche CAPE-Return-Policy | `vpw-return-policy.test.mjs` | `core-engine.test.mjs`, `worker-parity.test.mjs`, Balance-Diagnose-Tests |
| Konservatives Langlebigkeitsmodell | `longevity-contract.test.mjs`, `longevity-horizon.test.mjs` | `longevity-engine-runner.test.mjs`, `longevity-ui-persistence.test.mjs`, `longevity-optimizer-docs.test.mjs`, `worker-parity.test.mjs` |
| Stationary Bootstrap | `stationary-bootstrap-contract.test.mjs`, `stationary-bootstrap-sampler.test.mjs` | `mc-worker-contract.test.mjs`, `worker-parity.test.mjs` |
| Tail-Risk-/Crash-Overlay | `tail-risk-contract.test.mjs`, `tail-risk-overlay.test.mjs` | `simulator-input-readers.test.mjs`, `simulator-monte-carlo.test.mjs`, `worker-parity.test.mjs` |
| Simulator-Realentnahme | `simulator-real-withdrawal-contract.test.mjs` | Drei-Jahres-Faktor, Anspar-Transition, effektive Realentnahme, MC-Stichprobe und App-/Engine-State-Spiegelung |
| Architektur-/Fachkonzept-Evidenz | `architecture-evidence.test.mjs` | `npm run docs:evidence`, offline im regulären `npm test`-Gate |
| Projektlizenz-Metadaten | `project-license-metadata.test.mjs` | MIT-Konsistenz in Lizenztext, npm-/Lockfile-Root, Cargo, README und Markt-GAP |

Die Tests sichern Contracts, Grenzwerte, Determinismus, Nicht-Mutation, Runner-Integration und Worker-/Chunk-Paritaet. Sie belegen keine empirische Kalibrierung des Tail-Risk-Modells und keine Prognoseguete gegen unbekannte kuenftige Marktdaten.

### 1. Engine Core & Validation

#### `core-engine.test.mjs`
**Zweck:** Validiert die grundlegende `EngineAPI`-Integrität und Ausgabestrukturen.
- Prüft dass `EngineAPI.simulateSingleYear()` korrekte Ergebnisobjekte liefert
- Validiert UI-Ausgabestruktur (spending, market, action, diagnosis)
- Testet Engine-Version und Build-ID

#### `engine-robustness.test.mjs`
**Zweck:** Robustheitstests gegen Edge Cases und fehlerhafte Eingaben.
- **Inflation:** Nullinflation, historische Deflation bis -15%, hohe Inflation
  bis 50% sowie out-of-range unter -15% und über 50%
- **Marktextreme:** 100% Jahresperformance, 0% Return

#### `tauri-csp.test.mjs`
**Zweck:** Contract-Test fuer Tauri-Release-Konfiguration und CSP.
- Prüft `frontendDist`, Produktname und Fensterbasis.
- Validiert erlaubte Live-Datenziele fuer Yahoo-Proxy, ECB, World Bank, OECD und CAPE via `r.jina.ai`.
- Prüft Worker-, Script-, Style- und Font-CSP sowie bewusst gesetztes `dangerousDisableAssetCspModification`.
- Stellt sicher, dass die in `tauri.conf.json` referenzierten Bundle-Icons existieren.
- **Ungültige Werte:** Negative Assets, NaN/Infinity, fehlende Pflichtfelder
- **Pflichtbedarfe:** Fehlende `floorBedarf`/`flexBedarf` werden als `ValidationError` gemeldet.
- **Grenzwerte:** Extreme hohe Werte (>100M), leeres Portfolio
- **Alter:** Out-of-range (5 Jahre, >120 Jahre)
- Stellt sicher dass ValidationErrors sauber zurückgegeben werden (kein Crash)

#### `market-analyzer.test.mjs`
**Zweck:** Validiert Markt-Diagnose-Funktionen.
- ATH-Drawdown-Erkennung
- CAPE-Bewertungssignale
- Szenario-Klassifizierung (Bear/Peak/Recovery/Hot/Sideways)
- Regime-Übergänge und -Persistenz

#### `historical-data-robustness.test.mjs`
**Zweck:** Testet Verhalten bei fehlenden oder leeren historischen Daten.
- Fallback auf SIDEWAYS-Regime wenn Daten fehlen
- Graceful degradation ohne Crash

### 2. Spending/Entnahme-Logik

#### `spending-planner.test.mjs`
**Zweck:** Validiert den SpendingPlanner im Engine.
- **Fail-Safe Alarm:** Prüft Alarm-Logik bei kritischen Withdrawal Rates
- **Flex-Rate Smoothing:** Validiert den Glättungsalgorithmus für Flex-Anteile
- **Budget Floor Protection:** Stellt sicher dass Mindest-Entnahmen geschützt sind
- **Guardrail-Integration:** Tests für Ceiling/Floor-Mechanismen
- **Mindest-Flex:** Prüft Contract, haushaltsweite Anrechnung des Rentenueberschusses, Notfall-/Runway-Blockaden, Pipeline-Ordering vor Flex-Budget/Final-Limits, finale Quantisierung und die Interaktion mit niedrigem Dynamic-Flex-Stage-2-Safety-Flex. Nicht-finite vorhandene Eingaben werden an Engine- und Simulatorgrenze abgelehnt statt auf null ersetzt.

#### `spending-flex-trace.test.mjs`
**Zweck:** Belegt den rein lesenden `spendingResult.flexTrace` mit wenigen synthetischen Fixtures.
- Exakte Gleichheit aller bisherigen Ergebnisse, Diagnose und State mit/ohne Collector; Eingaben und Vorjahresdaten bleiben unverändert.
- Unabhängige, eingefrorene Momentaufnahmen und lückenlose Monatskette mit positiven Anhebungen und negativen Kürzungen.
- S-Kurve außerhalb des Bärenmarkts, nicht übernommener Kurvenwert, Vermögensdämpfung, Bären-/Runway-/Recovery-Cap, beide Alarmzustände, Mindest-Flex mit Budgetbegrenzung, Safety-Verschiebung und schwere Notlage.
- Alle drei Rundungsstufen, tatsächlicher Glättungsanker, Floor-geschützter Abschlag und Netto-Flex null; kein Browser-/EXE-Nachweis.
- Engine-Einstiege ohne Collector als Standard, ausdrücklich zuschaltbare Diagnose mit exakter Ergebnisgleichheit; unbegrenzte Runway bei Bedarf null als `null` im Trace, einschließlich strikter Monte-Carlo-JSON-Normalisierung.
- `monte-carlo-export-contract.test.mjs` belegt an einem realen Lauf, dass kein simuliertes Jahr den Collector aktiviert und Ergebnis sowie V1-/V2-Exporte keinen `flexTrace` enthalten. `stress-replay-e2e.test.mjs` prüft den zuvor scheiternden Nullbedarf-Roundtrip.

#### `spending-safety-cap.test.mjs`
**Zweck:** Validiert `SpendingPolicyOrderV2`, normale Safety-Obergrenze und das
konjunktive Null-Flex-Gate.
- Prüft strukturelle Quellen/Anchor, Minimum- und Gleichstandsregeln sowie die
  Trennung von Textlabels und tatsaechlicher Ratenwirkung.
- Deckt die Schwellen 24,99/25,00/25,01 Prozent, Alarm an/aus,
  Entnahmebelastungsfaktor 0/1 und den C-16-Wechsel 0 -> normal -> 0 ab.
- Belegt, dass normaler Safety-Cap Mindest-Flex respektiert, die schwere
  Notlage alle Flex-Floors ueberstimmt und der Floor centgenau geschuetzt
  bleibt.
- Fehlende oder nicht-endliche Drawdowns scheitern fail-closed; ein endlicher
  negativer Vor-Peak-Wert wird als neues reales Hoch auf 0 normalisiert.

#### `spending-quantization.test.mjs`
**Zweck:** Testet die Anti-Pseudo-Accuracy-Rundungslogik für Entnahmen.
- **Tier-basierte Rundung:**
  - Tier 1 (<2000): Schritt 50
  - Tier 2 (<5000): Schritt 100
  - Tier 3 (>5000): Schritt 250
- Integrationstests mit SpendingPlanner
- Prüft dass monatliche Entnahmen auf sinnvolle Schritte gerundet werden

### 3. Transaktions-Engine

#### `liquidity-runway-contract.test.mjs`
**Zweck:** Pinnt den reinen kanonischen Slice-08-Runwayvertrag.
- Default 5 Jahre, Bereich 1 bis 10 und Schrittweite 0,5;
- Legacy-Prioritaet `liquidityRunwayYears` vor `runwayTargetMonths`,
  `runwayMinMonths` und Default; alle 104 alten UI-Monatswerte werden ohne
  Verkuerzung auf das naechste Halbjahr normalisiert;
- leere und ungueltige kanonische Werte, negative Werte, Nicht-0,5-Schritte
  und kontrolliert scheiternde Migration;
- exaktes Liquiditaetsziel und abgeleitete harte Mindest-Policy.

Transaktionen, VPW, Post-Payout-Nullsemantik, Goldband sowie Sweep-/Optimizer-
Inventar liegen bewusst in den jeweiligen Fachtests.

#### `liquidity-guardrail.test.mjs`
**Zweck:** Validiert operative Guardrails.
- **Bear Market Refill Caps:** Begrenzt Nachfüllung in Bärenmärkten
- **Benannter Bear-Cap-Grenzzeuge:** Bei exakt 75 Prozent Zieldeckung bleibt das quantisierte Standard-Cap aktiv; einen Euro darunter aktiviert `isCriticalLiquidityBear` das 10-Prozent-Notfall-Cap. Nullgewinn-Lots isolieren dabei Verkaufs- und Liquiditaetswirkung von der Steuer; die Diagnose muss die tatsaechlich wirksame Standard- beziehungsweise Notfall-Prozentgrenze ausweisen.
- **Runway Coverage Triggers:** Aktiviert bei kritischer Liquiditätsdeckung
- Minimum-Runway-Enforcement

#### `transaction-tax.test.mjs`
**Zweck:** Validiert die komplette Steuerlogik.
- **Abgeltungssteuer:** Korrekte Berechnung (26,375% + Soli)
- **Teilfreistellung (TQF):** 30% für Aktienfonds
- **Sparer-Pauschbetrag:** Korrekte Anwendung und Verbrauch
- **FIFO Cost-Basis Tracking:** Korrekte Kostenbasis-Verfolgung
- **Kirchensteuer:** Zusätzliche Steuerbelastung
- Steueroptimierte Verkaufsreihenfolge
- **Zwei Gewinnquoten:** `gainQuotePlan` (≥ 0) vs. `gainQuoteSigned` (mit Vorzeichen für Verlustpositionen)
- **TQF-Symmetrie:** Teilfreistellung wird symmetrisch auf Verluste angewandt (§ 22 InvStG)
- **Roh-Aggregate:** `sumRealizedGainSigned`, `sumTaxableAfterTqfSigned` für Settlement
- **Profilherkunft:** Detailtranchen-Verkaeufe bewahren profilbezogene `trancheId` und `sourceProfileId`

#### `tax-settlement.test.mjs`
**Zweck:** Validiert das Jahres-Settlement (Verlustverrechnungstopf).
- **Verrechnungsreihenfolge:** lossCarry → SPB → Steuer
- **Negativer Jahressaldo:** Zero Tax, additive lossCarry-Fortschreibung
- **Exakter Aufbrauch:** Floating-Point-Robustheit bei lossCarry = Gewinn
- **SPB-Restverbrauch:** SPB absorbiert Rest nach lossCarry
- **Non-Mutation:** taxStatePrev wird nicht verändert

#### `core-tax-settlement.test.mjs`
**Zweck:** End-to-End-Integration Settlement in Engine.
- **taxState-Fortschreibung:** `lastState.taxState.lossCarry` wird korrekt propagiert
- **action.steuer:** Enthält Settlement-Steuer (nicht Sale-Plan-Steuer)
- **Reserve-Reconciliation:** Plansteuer, Plan-Netto, finale Steuer und einmalige Liquiditaetsgutschrift erfuellen die Cash-Invarianten
- **Globale Quellen-Reconciliation:** Auch ohne Balance-3-Bucket-Flag entsprechen Quellen-Netto und nichtnegative Einzelquellen der finalen Action und ihren Verwendungen
- **Golden Cases:** Kein, teilweiser und ueberdeckender LossCarry sowie No-Transaction
- **Signierte Tranchen:** Reine Verluste und gemischte Gewinn-/Verlusttranchen bleiben endlich und vorzeichengetreu
- **taxRawAggregate:** Roh-Aggregate in UI-Ausgabe vorhanden
- **Default-Robustheit:** `lastState: {}` ohne taxState funktioniert

#### `simulator-tax-settlement.test.mjs`
**Zweck:** Simulator-Integration mit Gesamt-Settlement-Recompute.
- **Notfallverkauf-Recompute:** Bei Forced Sales werden reguläre + Notfall-Aggregate kombiniert und Settlement neu berechnet
- **3-Bucket-Recompute:** Eine Bad-Year-Ersetzung durch Bondquellen wird auf ihrem finalen Rohaggregat zentral abgerechnet; der blockierte Aktienplan darf weder Steuer noch Verlustvortrag fortschreiben
- **Kein-Notfall-Regression:** Ohne Forced Sale bleibt Engine-Settlement unverändert
- **Steuerkonsistenz:** `totalTaxesThisYear` kommt aus Settlement
- **Ausfuehrungsskalierung:** Regulaere Reserve und Rohaggregate verwenden denselben `regularSaleScale`; Forced-Sale-Plansteuer wird ohne zweiten SPB skaliert reserviert
- **Cash-Reconciliation:** `taxReservedTotal - taxDueFinal` wird genau einmal als `taxCashAdjustment` gebucht
- **Zwei Action-Phasen:** `plannedActionFlow` bleibt vor Ausfuehrung quellen-/verwendungskonsistent; `SimulatorExecutedTaxContractV1` prueft dessen Reserve gegen finale Verkaufssteuer, Zinssteuer, Jahressteuer und Cash-Anpassung
- **Adaptergrenze:** Formal ausgeglichene, aber zentral falsch abgerechnete Engine-Steuer sowie werfende Action-/Steueraggregat-Getter enden kontrolliert als technischer Vertragsfehler
- **Steuer-Inventarmodell V1:** `proportional_market_value_v1` bindet die internen signierten Lot-Rohwerte mit absolut `1e-7` an die proportionale Marktwert-/Cost-Basis-Reduktion. Nichtproportionale Auswahl oder centgerundete Fremdadapter sind bewusst kein V1-Kompatibilitaetsfall.
- **Mehrjahresinvariante:** Zehn deterministische Gewinn-/Verlustjahre mit regulaeren und erzwungenen Verkaeufen zeigen keine kumulative Steuer-/Cash-Drift

#### `transaction-engine-ath.test.mjs`
**Zweck:** Testet Transaktionsverhalten bei All-Time-High.
- Bei ATH ohne Runway-Lücke: Opportunistisches Rebalancing statt Notfüllung
- Guardrail-Cliff-Test: Korrekte Auffüllung nahe Ziel
- Prüft dass keine unnötige Notfüllung ausgelöst wird

#### `transaction-engine-rebal.test.mjs`
**Zweck:** Testet Gold-Rebalancing-Logik.
- **Gold Drift:** Verkauf bei starker Übergewichtung (>30% statt Ziel 7,5%)
- Band-Verletzung führt zu Rebalancing-Transaktion
- Prüft korrekte Quellen und Verkaufsbeträge

#### `transaction-gold-liquidity.test.mjs`
**Zweck:** Testet Gold-Kauf vs. Liquiditätslücke.
- **Blockierung:** Kein Gold-Kauf wenn Liquidität unter Ziel
- **Freigabe:** Gold-Kauf erlaubt bei Liquiditätsüberschuss
- Priorität: Liquidität vor Gold-Allokation

#### `transaction-quantization.test.mjs`
**Zweck:** Testet die Transaktions-Rundungslogik.
- **Tier-basierte Brutto-Rundung:**
  - <10k: Schritt 1k
  - <50k: Schritt 5k
  - <200k: Schritt 10k
  - >200k: Schritt 25k
- **Hysterese:** Kleine Lücken (<2k) lösen keine Transaktion aus
- **Opportunistisches Refill:** Korrekte Rundung bei Auffüllung
- **Surplus-Investition:** Floor-Rundung bei Überschüssen
- **Komponenten-Rundung:** Gilt auch für Gold-Verkäufe

### 4. Monte-Carlo-Simulation

#### `monte-carlo-measurement-contract.test.mjs`
**Zweck:** Validiert Golden Cases, unveraenderliche Snapshot-Linie, Delta-Ledger, Same-Runtime-Exaktheit sowie Direct-/Worker-/Chunk-Paritaet.
- **V2-Ressourcenerweiterung:** Die drei neuen Real-Drawdown-Buffer werden separat auf Registrierung und Paritaet geprueft. Die eingefrorene V1-Snapshotprojektion misst weiterhin nur den historischen V1-Bufferbestand, damit eine additive V2-Ressource keinen semantisch unveraenderten V1-Hash umdeutet.
- **Aktuelle Referenz:** Die oeffentliche `currentReference` ist `null`,
  solange kein extern freigegebener Nachfolger vorliegt;
  `post-backtest-data-07-v1` ist der neueste getrennte, noch extern zu
  reviewende Demografie-/Pflege-/Hinterbliebenen-Messkandidat auf Basis von
  `post-backtest-data-06-v2`. Der
  veraenderliche Zeiger ist aus der eingefrorenen
  Ergebnisprojektion ausgeschlossen. Keine fruehere Fixture wird
  ueberschrieben und eine reine Zeigeraenderung erzeugt keinen
  Folgesnapshot.
- **Slice-02-Delta:** Die harte Nullsemantik fuer `maxSkimPctOfEq` und das Equity-Gesamtbudget veraendert im festen Acht-Run-Fall nur Volatilitaet und maximalen Drawdown von Run 6 sowie die davon abgeleitete Median-Volatilitaet.
- **Invarianten:** Direct-Runner-CaR, alle anderen Pfad-/Aggregatwerte, Outcome-Inventar, Missingness und Datenprovenienz bleiben exakt.
- **Slice-11-Kandidat:** `post-suite-data-11-v1` bleibt bis zum externen Review
  `pending`, dokumentiert D-14-Runwerte, Rohverteilungen und das erwartete
  Bufferdelta 93 auf 106 Byte pro Run, ohne fruehere Referenzen zu
  ueberschreiben.
- **Backtest-Data-Slice-02-Kandidat:** `post-backtest-data-02-v3` friert die
  neue Aktien-Datenversion sowie Risiko-, CaR-, Sampling- und
  Auto-Optimize-Projektionen fuer denselben Seed und dasselbe Workerlayout
  ein. V1 und V2 bleiben als ueberholte, unreviewte Kandidaten unveraendert;
  der Erzeugungsmodus darf V3 nicht ueberschreiben und endet absichtlich
  nicht gruen. V3 bleibt bis zum externen Review `pending`.
- **Backtest-Data-Slice-03-Kandidat:** `post-backtest-data-03-v1` baut
  unveraenderlich auf V3 auf und friert die CPI-Datenversion samt Risiko-,
  CaR-, Sampling- und Auto-Optimize-Projektionen ein. Der Erzeugungsmodus
  verweigert ein Ueberschreiben; der Kandidat bleibt bis zum externen Review
  `pending`. Die oeffentliche `currentReference` bleibt deshalb `null`.
- **Backtest-Data-Slice-04-Kandidat:** `post-backtest-data-04-v1` baut
  unveraenderlich auf dem Slice-03-Kandidaten auf und friert nur die neue
  Cash-/Geldmarkt-Datenprovenienz samt erwarteten Modellprojektionen ein.
  Der Kandidat bleibt bis zum erneuten externen Review `pending`.
- **Backtest-Data-Slice-05-Kandidat:** `post-backtest-data-05-v1` baut
  unveraenderlich auf dem Slice-04-Kandidaten auf und friert die neue
  Gold-Datenprovenienz samt erwarteten Modellprojektionen ein. Der Kandidat
  bleibt `pending`; weder Slice 04 noch eine andere Eingangsfixture wird
  ueberschrieben.
- **Backtest-Data-Slice-06-Kandidat:** `post-backtest-data-06-v1` bleibt als
  unveraenderlicher Kandidat mit unvollstaendig behauptetem Messumfang und
  fehlerhaftem Evidenzvertrag erhalten. `post-backtest-data-06-v2` ist sein
  zur Laufzeit zeitgestempelter Nachfolger. V2 sagt explizit, dass die sechs
  Golden Cases weder Gold-, CAPE-Sampling- noch lohnindexierte Rentenwirkung
  messen, und belegt gegen Slice 05 exakt null numerische Deltas; nur Identitaet,
  Erfassungsnachweis, Messscope und `annualDataHash` duerfen abweichen. Beide
  Slice-06-Kandidaten bleiben `pending`.
- **Backtest-Data-Slice-07-Kandidat:** `post-backtest-data-07-v1` vergleicht
  bei identischem Node, Profil, Seed und Input den unveraenderlichen
  Slice-06-Basiscommit mit dem Slice-07-Arbeitsstand. Der Lauf umfasst 2.048
  Runs, 40 Jahre, aktiven Pflege-/Partner-/Hinterbliebenenpfad und zwei
  Sweep-Kombinationen. 40 numerische Deltas, 44 geaenderte Blaetter und ihre
  Hashes sind eingefroren; der Kandidat bleibt bis zum externen Review
  `pending`.
- **Slice-08-Messung:**
  `fixtures/liquidity-runway-slice-08-measurement-v1.json` und
  `fixtures/monte-carlo-measurement/liquidity-runway-slice-08-v1.json`
  dokumentieren die getrennte Wirkung des kanonischen Runway-/Puffervertrags.
  Die grossen Slice-07-Eingangsfixtures bleiben byte-identisch und werden per
  SHA-256 geschuetzt; die neuen Fixtures sind technische Messbelege und keine
  externe Modellfreigabe.
- **Slice-09-Messung:**
  `fixtures/minimum-flex-slice-09-measurement-v1.json` konsumiert die
  bytegeschuetzte Slice-08-Messung als Eingangsreferenz, ergaenzt den
  historischen D-17-Zeugen fuer 2001/2005/2009/2010 und weist fuer alle elf
  bestehenden positiven Faelle exakt null Endvermoegens-, Entnahme-, Steuer-,
  Outcome- und FlowDelta-Deltas aus. Der Kandidat bleibt bis zum externen
  Review `pending`; die Slice-08-Fixture wird nicht ueberschrieben.
  `fixtures/monte-carlo-measurement/minimum-flex-slice-09-v1.json` bindet
  ebenso die byteidentische Slice-08-Monte-Carlo-Fixture und weist fuer die
  gemessenen MC-/Sweep-Aggregatprojektionen drei unveraenderte Hashes und null
  Projektdeltas aus. Aktive Soll/Ist/Fehlbetrag-Rowparitaet wird getrennt im
  Worker-Vertrag belegt und nicht als Aggregatmessung ausgegeben.
- **Slice-17-Messung:**
  `fixtures/liquidity-runway-basis-slice-17-measurement-v1.json` bindet die
  wertveraendernde Korrektur der Runway-Bedarfsbasis als neuen Pending-
  Kandidaten. Die Datei referenziert die byteidentischen Slice-10-/13-
  Eingangsfixtures und pinnt getrennte Zielhashes fuer Backtest,
  Monte-Carlo/Sweep, Demografie/Pflege sowie den synthetischen
  Export-Fingerprint. Sie bindet zusaetzlich den lebenden
  `crossSliceOracleProjection`, das vollstaendige Slice-09-nach-10-Deltaledger
  und einen Safety-Gegenzeugen mit post-policy operativem sowie pre-policy
  Dynamic-Flex-Safety-Runway. Persoenliche Daten des Nutzer-Replays sind nicht
  enthalten. Die historischen Fixtures werden nicht ueberschrieben; der alte
  Slice-10-Updatepfad ist absichtlich blockiert.
- **Abschlusshaertung Slice-03-Messung:**
  `fixtures/safety-policy-slice-03-measurement-v1.json` bindet die
  bytegeschuetzten Backtest-/Demografie- und Monte-Carlo-Eingangsgrenzen als
  neuen Pending-Kandidaten. Die 2000-2025-Messung weist vier schwere
  Null-Flex-Jahre (2002-2004 und 2008), 0 Floorverletzungen, FlowDelta 0 sowie
  Entnahme-, Steuer- und Endvermoegensdelta aus. Monte Carlo und
  Demografie/Pflege besitzen getrennte Zielhashes; persoenliche Replaydaten
  sind nicht enthalten. `reviewStatus` bleibt bis zur externen Codepruefung
  `pending_external_review`.
- **Mindest-Flex-Tragfaehigkeitsmessung:**
  `fixtures/minimum-flex-severe-affordability-measurement-v1.json` ist der
  versionierte Nachfolger der unveraenderten Slice-03-Fixture. Das schwere
  Null-Flex-Gate verlangt zusaetzlich eine geschuetzte Portfolioentnahmequote
  von mindestens 3,5 Prozent. Backtest, Monte Carlo/Sweep und Demografie/Pflege
  binden ihre neuen Finanzpfade getrennt; Outcome-, Pflege-, technische und
  FlowDelta-Invarianten bleiben sichtbar. Persoenliche Replaydaten sind nicht
  enthalten, der Kandidat bleibt `pending_external_review`.
- **Historische Fixture-Kompatibilitaet:** Vergleichsausnahmen fuer
  unveraenderliche Pending-Fixtures stehen ausschliesslich in
  `snapshot-policy-v1.json`. Der produktive Runtime-Vertrag enthaelt weder
  Fixture-Pfade noch ein `ignoredHistoricalFixtureFields`-Feld.
- **Ressourcenmessung:** Das feste Standardprofil mit 100.000 Runs ergab
  977,62585 gesamte Worker-Result-Byte pro Run; der Laufzeitvertrag verwendet
  gerundete 978 Byte pro Run.

#### `monte-carlo-sampling.test.mjs`
**Zweck:** Validiert den statistischen Kern der Simulation.
- **Block-Bootstrap Sampling:** Korrelationserhaltung historischer Daten
- **Regime-Transitions:** Wahrscheinlichkeitsbasierte Übergänge (Bull/Bear/Sideways/Stagflation)
- Determinismus bei gleichem Seed

#### `monte-carlo-startyear.test.mjs`
**Zweck:** Validiert die gewichtete Startjahr-Auswahl.
- **Filter Mode:** Einschränkung auf bestimmte Jahre
- **Recency Mode:** Höhere Gewichtung für jüngere Jahre
- **Uniform Mode:** Gleichverteilte Auswahl
- Deterministische CDF-Auswahl

#### `simulator-monte-carlo.test.mjs`
**Zweck:** Umfassende Tests für den MC-Kern.
- **Heatmap Merge:** Korrekte Akkumulation von Chunk-Ergebnissen
- **pickWorstRun:** Tie-Breaker-Logik (Endvermögen → comboIdx → runIdx)
- **Buffer-Strukturen:** finalOutcomes, taxOutcomes, kpiLebensdauer etc.
- **Aggregates:** P10/P50/P90 Berechnung, Erfolgsquote, Drawdown
- **Chunk-Merge:** Split- vs. Full-Run Konsistenz
- **Determinismus:** Gleicher Seed → gleiche Ergebnisse
- **Ruin-Zählung:** Übereinstimmung mit finalOutcomes ≤ 0
- **Perzentile:** P10 < P50 < P90 Ordnung
- **Mindest-Flex:** Serial-MC-Lauf mit `minimumFlexAnnual > 0` inklusive Withdrawal-Effekt und Logstatus.

#### `results-metrics.test.mjs`
**Zweck:** Sichert den sichtbaren Ergebnisvertrag ohne DOM.
- **Präzises Label:** Ruin oder Aktien/Gold-Endbestand ≤ 100 Euro statt
  vollständiger Vermögensaufzehrung
- **Aussagegrenze:** `isRuin`, freie Liquidität und Pflegebucket werden im
  Beschreibungstext ausdrücklich eingeordnet
- **Kompatibilität:** Prozentformatierung, Altersanzeige und bestehende
  Success-/Warning-/Danger-Schwellen bleiben unverändert
- **Exaktwerte:** P10/P50/P90-Endvermoegen ohne Grobstufen, reale
  Depotentnahme P10, Median der Run-P10, Steuermedian und
  Verlustvortragsersparnis bleiben centgenau und primaer sichtbar
- **Rundungsrichtung:** Zusatzdezimal-Fixtures sichern Nutzen abwaerts, Kosten
  aufwaerts und positive Drawdown-Verlustbetraege aufwaerts; Gleitkommawerte
  nahe einer exakten Centgrenze bleiben stabil
- **Drawdown:** nominale/reale Preisbasis, Paarreihenfolge, gueltige
  Grenzwerte 0/34,25/100 sowie fail-closed Verhalten fuer negative,
  groesser-100-, nicht endliche, fehlende und nicht anwendbare Werte
- **Missingness:** fehlende Beobachtungszahlen erscheinen als `unbekannt`;
  bei mehreren Gruenden gewinnt der hoechste aggregierte Zaehler
- **Copy:** strikt-`>`-Berichtsreferenz und sichtbar nicht kausaler
  Pflege-Gruppenmedianvergleich

#### `care-meta.test.mjs`
**Zweck:** Validiert die Pflegefall-Logik.
- **Eintrittswahrscheinlichkeit:** Altersabhängige Pflegewahrscheinlichkeit
- **Kostenrampe:** Inflation und Progression der Pflegekosten
- **Einheitenvertrag:** 0/3,5/100 %, direkte Verhältnisverwendung, zweijährige
  Driftfortschreibung sowie Cap-/Ramp-up-Wirkung ohne doppelte Skalierung
- **Dual-Household:** Flex-Budget-Anpassung bei Pflege beider Partner
- Pflegegrade (PG 0-5) und ambulant vs. stationär

### Pflegebucket
**Datei:** `health-bucket.test.mjs`

**Zweck:** Testet die gesperrte Geldmarkt-/Cash-Reserve fuer Pflegefaelle.
- **Trigger:** Mindestpflegegrad, `OR`-/`AND`-Modus und P1/P2-Care-Metadaten ueber `householdContext.care`.
- **Deckung:** `care_additional_floor_only` und `floor_when_care_active`.
- **Air Gap:** Bucket-Betraege werden nicht als freie operative Liquiditaet behandelt.
- **Verbrauch:** FIFO-Reduktion der Bucket-Tranchen, Restbetrag und Warnungen.
- **Diagnose:** Verzinsung mit `rC`, inflationsindexierter Zielwert, Zieldeckung und Ziel-Luecke.

### 5. Parameter-Sweep & Optimierung

#### `simulator-sweep.test.mjs`
**Zweck:** Validiert Parameter-Sweep-Funktionalität.
- **parseRangeInput:** Einzelwerte, Kommalisten, Range-Format (start:step:end)
- **cartesianProductLimited:** Kartesisches Produkt mit Limit-Schutz
- **Whitelist/Blocklist:** SWEEP_ALLOWED_KEYS, isBlockedKey für Partner-/P2-Felder
- **P2-Invarianten:** extractP2Invariants, areP2InvariantsEqual
- **normalizeWidowOptions:** Default-Werte und Normalisierung
- **buildSweepInputs:** Parameter-Überschreibung
- **runSweepChunk:** Ausführung und Determinismus
- **Mindest-Flex:** Sweep-Chunk mit gesetztem `minimumFlexAnnual` bleibt gueltig und berechnet Metriken.
- **Common Random Numbers:** Wirkungsgleiche Kombinationen verwenden je
  Run-Index identische Seeds, Sampling-Rohpfade und Metriken. Wirkungsvoll
  verschiedene Kombinationen belegen denselben Rohpfadpraefix bis zu einer
  strategieabhaengigen Terminierung, ohne vollstaendige Pfadgleichheit zu
  behaupten.
- **Terminalruin:** Der Nullpunkt wird vor dem Abbruch in die Drawdownserie
  aufgenommen und ergibt aus positivem Peak exakt 100 Prozent Drawdown.

#### `sweep-metrics.test.mjs`
**Zweck:** Testet den versionierten Sweep-Metrik- und Unsicherheitsvertrag.
- **D-06:** P95 des aufsteigend sortierten nichtnegativen
  Drawdown-Verlustmasses sowie handberechnete Reihe 1 bis 100.
- **Kanonische Quantile:** P10, P25, Median und P75 des Endvermoegens
  verwenden denselben interpolierten Quantilhelfer wie der Drawdown.
- **Saettigung:** Terminalruinanzahl und -anteil sowie ein im Ruinblock
  liegendes P95 werden explizit diagnostiziert.
- **Metadaten:** Einheit, Richtung, Rohquelle, Quantilrichtung und
  Terminalruin-Semantik sind versioniert. `minRunwayObserved` liest in
  `SweepMetricsV4` ausschliesslich kanonische Vor-Auszahlungs-Monate; eine
  Prozentdeckung, falsche Phase oder fehlendes Monatsfeld wird nicht
  stillschweigend uebernommen.
- **Unsicherheit:** Runzahl, CRN-Status und Wilson-95-Prozent-Intervall der
  Erfolgsquote; Quantil-Konfidenzintervall bleibt explizit `null`.
- **Contract-Reader:** Unversionierte und nicht endliche Metrikwerte werden
  fail-closed abgewiesen; Drawdownverluste ausserhalb 0 bis 100 werfen
  ebenfalls fail-closed.

#### `simulator-sweep-consumers.test.mjs`
**Zweck:** Sichert den gemeinsamen Metrikshape aller Sweep-Consumer.
- Parametervergleich, Multi-Objective und Constraints lesen nur den
  kanonischen versionierten Shape.
- Pareto-Berechnung und -Rendering schliessen Legacy-/NaN-Werte aus.
- Gesaettigte Drawdownziele werden in Heatmap und Pareto sichtbar
  ausgewiesen; exakte Ranking-Gleichstaende waehlen nicht mehr den ersten
  Arrayeintrag.

#### `auto-optimizer.test.mjs`
**Zweck:** Testet die mehrphasige Auto-Optimierung.
- **Latin Hypercube Sampling:** Gleichmäßige Verteilung im Parameterraum
- **Quick-/Full-Evaluation:** Kandidaten werden vor der vollständigen Bewertung vorgefiltert
- **Nachbarschafts-Generierung:** generateNeighborsReduced
- **Kandidaten-Validierung:** zentrale Parameterregistry
  (`isAutoOptimizeCandidateValid`) mit Runway-Invariante, Gold-Cap,
  Domains und Modus-Anwendbarkeit
- **Constraint-Prüfung:** checkConstraints (SR99, NOEX, TS45, DD55)
- **Objective-Extraktion:** getObjectiveValue für verschiedene Metriken
- **CandidateCache:** Vermeidung redundanter Evaluierungen
- **Tie-Breaker:** Höhere Success Rate, niedrigerer Drawdown
- **Fail-closed:** Fehlende Objective-, Constraint- oder Tiebreaker-Metriken
  werden nicht als guenstige numerische 0 behandelt. Beide
  Tiebreaker-Ergebnisse muessen `AutoOptimizeMetricResultV1` tragen; Bool,
  Array und numerischer String gelten nicht als Zahlen.
- **Safety-Penalty:** Fehlende D-14-Entnahmequote bricht die
  Dynamic-Flex-Bewertung mit `AUTO_OPTIMIZE_METRIC_UNAVAILABLE` ab und ist
  nicht gleichbedeutend mit einer beobachteten Nullquote.
- **Champion-Findung:** Konvergenz nahe Optimum
- **Modellannahmen:** MC-Sampling, CAPE, Datenfilter und disjunkte
  Train-/Bestaetigungsseeds werden im Ergebnisvertrag ausgewiesen

#### `auto-optimize-fidelity.test.mjs`
**Zweck:** Sichert O-15/O-20 und die Evaluate-/Apply-Paritaet.
- Jeder interaktive Registryparameter perturbiert seinen kanonischen
  Request-Key; Null-Caps bleiben 0.
- Alle acht angebotenen Parameter besitzen kontrollierte, deterministische
  MC-Kausalitaets-Witnesses. `maxBearRefillPct` bleibt fuer explizite
  Nullwert-/Apply-Vertraege registriert, wird mangels Runner-Wirkungsnachweis
  aber weder im Parameterpicker noch in Presets angeboten.
- Gold 0/25 verwendet `goldZielProzent`, besitzt verschiedene
  Requestfingerprints und erzeugt unterschiedliche MC-Ergebnisse.
- Der direkte Horizon 15/55 wirkt unabhaengig vom Longevity-Modus im Resolver
  und normalen MC exakt;
  aktuarische Methoden ignorieren das Direktfeld und der Optimizer bietet es
  dort nicht an.
- Champion-Apply verlangt Evaluationsfingerprints, prueft Modus und alle
  Formularziele vor dem ersten Write und verifiziert Ruecklese-Fingerprint
  sowie Gold-/Go-Go-Aktivierungszustand; manipulierte oder nicht anwendbare
  Champions werden fail-closed abgewiesen.
- Reale Evaluate-Ergebnisse tragen `AutoOptimizeMetricResultV1`; P10, P25 und
  P50 bleiben geordnet und D-14 liefert eine endliche, stichprobengestuetzte
  Median-Entnahmequote.
- Ein echter Sofortruin-Witness mit nicht leerer Liquiditaet belegt, dass das
  tatsaechlich berechnete finale Ruinjahr in jedem Run enthalten bleibt und
  vor dem Auszahlungsschritt eine beobachtete Nullauszahlung statt des
  Restvermoegens als D-14-Zaehler verwendet.

#### `auto-optimize-metrics-contract.test.mjs`
**Zweck:** Sichert O-21 und den versionierten Slice-11-Metrikvertrag.
- Die Endvermoegensreihe 1 bis 100 liefert mit kanonischer linearer
  Interpolation P10 = 10,9, P25 = 25,75 und P50 = 50,5.
- D-14 bildet zuerst das arithmetische Mittel je Run und danach den Median
  ueber auswertbare Runs; echte 0 bleibt beobachtet, Missingness bleibt
  separat.
- Technische Pfade werden aus Endvermoegens- und Drawdownverteilungen
  entfernt; `sampleSize`, `excludedRuns` und
  `missingness.technical_error` reconciliieren die angeforderten Runs.
- Das zusaetzliche Quantilfeld waehlt tatsaechlich das gewuenschte
  Endvermoegensquantil; absichtlich vertauschte P10-/P25-Rangfolgen
  diskriminieren den jeweiligen Gewinner.
- Fehlende Objective-, Constraint- und Tiebreaker-Werte sowie
  unversionierte oder nicht primitiv numerische Shapes schlagen fail-closed
  fehl.

#### `auto-optimize-worker-contract.test.mjs`
**Zweck:** Testet den Worker-Merge-Contract des Auto-Optimize-MC-Pfads.
- Mock-Worker führt echte `runMonteCarloChunk()`-Jobs aus
- Vergleicht Auto-Optimize-Worker-Merge mit seriellem MC-Aggregat
- Prüft `failCount`, P10/P25/P50/P90, Erschöpfungsquote,
  Stress-Zeitanteil sowie D-14-Median, Stichprobengroesse und Missingness

### 6. Balance-App Module

#### Getrennte Kurzmeldungen und Aktionsfehler

- `balance-messages.test.mjs` ist im bestehenden Runner als `isolated` registriert und liefert gezählte Assertions mit minimalem DOM und kontrollierter Uhr. Belegt werden die zugänglichen getrennten Container und alle drei Toasttypen: Standard/`true` als Erfolg, `'info'` als neutraler Hinweis und `false` als Fehler, jeweils mit Originaltext, Symbol, Formklasse und Typkennzeichnung. Alle Typen durchlaufen Sichtbarkeit bis 5999 ms und Ablauf bei 6000 ms, Ersetzung mit voller neuer Frist auch bei identischem Text, explizit ausgeführte veraltete Callbacks und Neuinitialisierung mit alten/neuen DOM-Referenzen. Fehlender Toastcontainer ohne Fehlerfallback sowie Timer-/Global-Cleanup bleiben abgedeckt.
- Dieselbe Datei prüft gleichzeitige Berechnungs- und bereichsbezogene Aktionsfehler, unveränderte Präfixe/Validierungsdetails/Recoverytexte, Feldmarkierungen nur für Berechnungsvalidierung und gezieltes Rücksetzen. „Fehlermeldung schließen“, eindeutige Text-IDs und `aria-describedby` werden bei mehreren Bereichen und Ersatzfehlern geprüft. Manuelles Schließen fokussiert den nächsten bzw. verbleibenden Schließenknopf, zuletzt `#openDiagnosisBtn`; automatische Bereinigung und veraltete Knöpfe verschieben keinen Fokus. Die Liste wird erst mit Einträgen eine benannte Tabstation. Berechnungsbereinigung und Toastablauf erhalten Aktionsfehler.
- `balance-smoke.test.mjs` nutzt den echten Renderer, `balanceMain.update()` und die reale Formbindung: erfolgreiche, entprellte, Validierungs- und Enginefehlerupdates erhalten Toasts; korrigierte Eingaben bereinigen weiterhin Berechnungsfehler samt Feldmarkierungen, ohne Aktionsfehler zu entfernen. Reale Import-/CSV-/Snapshot-/Annualhandler belegen Ablehnung und Rollback, Bereichstrennung, leere Dateiauswahl, abgebrochene Bestätigungen, Annual-Reentranz und Aktionsvalidierung. `input` und `change` aller drei Dateiinputs bewirken exakt null zusätzliche Engineaufrufe und Hintergrundwrites. Aktionsfehler überleben echte Updates und einen echten Toastablauf; Schließen bewirkt weder Speicherlesen/-schreiben noch direkte oder entprellte Berechnung.
- `balance-ui-orchestration.test.mjs` injiziert bei echten JSON-/CSV-Handlern gezielt Dry-Run-, Replace-, Validierungs-, Final- und Provenienzbestätigungsfehler. Die Reihenfolge Rollbackversuch → Eingaben-/CSV-Provenienzrestore → abgewartete `PREVIEW` → ursprünglicher Aktionsfehler und unveränderte Fehlercodes einschließlich `rollback_failed` werden geprüft. `balance-smoke.test.mjs` ergänzt mit echtem Main und Renderer Baselinevergleiche für KPIs und Handlungsanweisung vor der Fehlerausgabe, Bereinigung verworfener Validierung samt `input-error`, Erhalt fremder Aktionsfehler und echte Fehler eines ungültigen Ausgangsstandes. Ein injizierter Wiederherstellungsvorschaufehler darf den ursprünglichen Aktionsfehler nicht unterdrücken. Die Wiederherstellungsvorschau erzeugt keinen zusätzlichen Speicherwrite oder Ersatz-Commit; bei `rollback_failed` bleibt der Recovery-Hinweis maßgeblich und Schließen repariert keine Daten.
- `balance-ui-orchestration.test.mjs` nutzt außerdem die echte Ordnerbindung und `StorageManager.connectFolder()`: ausstehende Auswahl, `AbortError`, fehlende Berechtigung, fehlgeschlagene Handle-Speicherung und erfolgreiche Verbindung. Nur Erfolg bereinigt den bisherigen Snapshotfehler nach Berechtigung und Speicherung; Abbruch erhält ihn, Fehler ersetzen ihn ohne fremde Bereiche zu löschen. Der bisherige `Promise<void>`-Vertrag bleibt bei Erfolg und Abbruch erhalten.
- `balance-annual-inflation.test.mjs` und `balance-annual-marketdata.test.mjs` prüfen interne Datenpfade einschließlich neutraler Fortschritts-/No-op-Hinweise und erhaltener Erfolgs-/Fehlertypen. `balance-annual-cape.test.mjs` sichert den internen CAPE-Quellen-/Fallbackvertrag; dessen Toasttyp wird im Jahresworkflow geprüft. `balance-annual-workflow-contract.test.mjs` trennt die internen Sperren `inFlight`, `fetchInFlight`, `etfInFlight` und ihre `nested`-Fehlergrenzen ausdrücklich vom gemeinsamen UI-Jahresabschluss: beide Jahresknöpfe verwenden `annualCloseInFlight`, ohne zweiten Commit bei Doppelklick oder abgeschlossener Periode. Lokale CAPE-Warnungen erscheinen als Hinweis bei unverändertem Text. `balance-expenses.test.mjs` prüft nutzerinitiierte Recoveryfehler und erhält Meldungen bei gesperrtem Reset oder abgebrochener Bestätigung. Die bestehenden Import-/Persistenz-/Jahres-/Profiltests sichern weiterhin die Daten- und Rollbackverträge.

Die Browsernachweise und ihre Meldungsobserver sind unter [Browser-Smoke-Gate](#browser-smoke-gate) beschrieben. Node-Suite und Browsergate bleiben getrennte Nachweise: Im orchestrierten Lauf führt allein der Orchestrator `npm test` auf dem jeweiligen Slice-Stand aus; die gesteuerte Sitzung fährt `npm run test:browser` außerhalb der Agentensandbox vor dem Merge. Die Dokumentation dieser Assertions ist keine neue Laufmessung und aktualisiert keine früheren Suitezahlen.

#### Auswertung: Vermögensverlauf und Jahresausgaben

- `balance-expenses-history.test.mjs`: lesende Slice-1-Projektion und neue aktive SVG-/Tabellendarstellung aller gespeicherten Profile; Nullimportjahr, laufendes Teiljahr, Ø-Vergleich, endliche Koordinaten, eindeutige getrennte SVG-Benennung/Beschreibung, Null-Markuperzeugung inaktiv und vollständiger Replace bei Leer-/Korruptzustand ohne Writes/Rohdaten.
- `balance-expenses.test.mjs`: echter CSV-Listener mit offenem Dateilesen, dann aktive Übersicht, genau ein Änderungsrückruf nach Speicherung; frische Jahresauswahl/Wechsel, Löschung und geflushter bestätigter Reset, keine Benachrichtigung bei wirkungslosen oder abgebrochenen Aktionen.
- `balance-ui-orchestration.test.mjs`: echter Tablistener zeichnet beide Abschnitte frisch, entfernt beim Verlassen vier Container und führt dabei weder Berechnung/Erfassung noch Fehlerbereinigung/Write aus.
- Das separate Browsergate `Balance expenses history` prüft Jahreswerte aus derselben Projektion, alle vier fokussierbaren Regionen, den laufenden echten CSV-Import beim Öffnen der Auswertung, Reload, Leerzustand, sichere Korruptionshinweise und den bestehenden Druckvertrag. Die Layoutmatrix verlangt vier gefüllte intern scrollende Regionen und eine gemeinsame Tabzeile ab 1366 CSS-Pixeln; mobile Tabs, die bestehende 720-px-Ausgaben-Check-Tabelle und Drawer bleiben geprüft. Der sichtbare Anlass heißt „Unterjährig“, gespeichert unverändert `manual`. Das Öffnen beider Abschnitte ist lesend; die automatische Importerfassung hat einen separaten Erfolgsrückruf und eigene Nachweise.

- `wealth-history-contract.test.mjs`: Eintrags-/Schema-/Datumsprüfung, Identitäten, ungerundete Beträge und abgeleitete Summen, lokale Tagesersetzung, getrennte Jahresstände sowie fehlende/defekte Historie.
- `balance-wealth-history.test.mjs`: frische Preview-Quelle, gemeinsame Schreibkoordination, State-/Registry-Readback, Profilwechsel, Write-/Flush-/Readbackfehler und echter Snapshot-Restore mit anschließend genau einem Jahresrecord; aktive/inaktive Erfassung, einmalige Capture-/Tabbindung, instrumentierte Tabwechsel ohne Engineupdate/Fehlerbereinigung/Write, Verlaufimport/Legacy/Ablehnung/Rollback jeweils aktiv und inaktiv ohne Tabwechsel, Datum, Jahres-No-op, UI-Rückruf-/Renderfehler nach bestätigt abgeschlossenem Jahr und Jahre vor 2026.
- `balance-wealth-history-chart.test.mjs`: chronologische unverändernde Aufbereitung, Jahresabschluss vor manuell bei gleichem Datum, genau drei Stapelgruppen, zugängliche SVG-/Tabellenausgabe, einzelne/Null-/große Stände sowie vollständiger Legacy-/Fehler-Replace; vier Haupttabs mit initialem Jahres-Update, Capture ausschließlich im vierten Panel, Datum aus maximalem validierten `asOf`, exakter Leertext und kein altes Datum bei Fehlern, instrumentierte Null-Inhaltserzeugung bei inaktiven Refreshs, frische Aktivierung und leere Container nach Deaktivierung.
- `balance-annual-workflow-contract.test.mjs`: genau ein Jahresrecord aus `commitLiveState().inputData`, abgeschlossene Periode/Stichtag, atomare finale Metadaten-/Verlaufbestätigung, unveränderte andere Profile, Idempotenz und Recovery-Sperren; Rückmeldung ausschließlich nach neuer finaler Bestätigung.
- Ergänzende Roundtrips und Negativfälle: `balance-storage-contract.test.mjs`, `balance-ui-orchestration.test.mjs`, `profile-state.test.mjs`, `profile-storage.test.mjs` und `persistence.test.mjs` für Balance-V2/V1/Legacy, Profilbundle, Komplettbackup und korrupte inaktive Profile.

Die endgültige Darstellung hält die vier vollständigen Haupttabs ab 1366 CSS-Pixeln Fensterbreite in einer Zeile; schmaler dürfen sie als ganze Tabs umbrechen, ohne Titel abzuschneiden. Capture, Anzahl und Inline-Datum mit unveränderter ID/Live-Ankündigung bilden eine gemeinsame Aktionszeile, die mobil umbrechen darf. Status bleibt separat. Diagramm und Verlaufstabelle scrollen intern, ohne die Formularspalte zu verbreitern; die Ausgabentabelle behält mindestens 720 px. Die gesamte Auswertung wird beim Drucken über das bestehende Ausblenden der Formularspalte ausgeschlossen. Node-Markuptests prüfen den gemeinsamen Aktionscontainer und die nicht fokussierbare Datumsankündigung; Capturetests prüfen aktiv/inaktiv sowie über den echten Clicklistener auf allen vier Tabs bei Erfolg, Validierungs-, Write- und Readbackfehlern, dass kein Tab geöffnet oder gewechselt wird.

Die Tabaktivität ist flüchtig: Start/Reload/Profilwechsel aktivieren „Jahres-Update“; Erfassung und Import erhalten den aktiven Tab. Datum/Anzahl werden inaktiv aktualisiert, SVG/Tabelle ausschließlich aktiv erzeugt. „Stand gesichert“ folgt erst dauerhaft bestätigter Speicherung; kein Tabfeld wird gespeichert oder exportiert. Die unveränderten Daten-/Replaceverträge bleiben geprüft.

Die Kurzmeldung ergänzt ausschließlich bei einem neuen, durch State-/Registry-Readback bestätigten Jahresstand ab 2026 exakt „Vermögensstand gesichert.“ (`Ausgaben-Check auf ${nextYear} umgestellt. Vermögensstand gesichert.`). Das lokale Flag folgt erfolgreichem `finalizeAnnual`; nach `completedResult` kommt zuerst der Toast und danach der flaggebundene UI-Rückruf, ohne erneute Jahresschwellenprüfung. Node-Prüfungen werten Toasttexte je Aktion ab eigenem Nachrichtenindex aus: neuer Abschluss 2026, No-op desselben Handlers, 2025, finale Write-/Flush-/Readbackfehler und angehaltener Readback nach dem finalen Backendwrite. Vor Freigabe fehlen Zusatz und Rückruf, danach erfolgen beide genau einmal. Rückruf-/Renderfehler lassen die vorherige Bestätigung sowie finale Daten und leeren Pendingmarker bestehen; Wiederholung erzeugt weder neuen Zusatz noch zweiten Engine-Commit. Ein injizierter Toastfehler erhält dieselbe Abschlusssemantik ohne Pflicht zur sichtbaren Ausgabe. Aktiver und inaktiver Verlauf werden geprüft.

`Balance annual commit` erfasst für beide Verlaufszustände eigene Indizes in `window.__browserSmokeMessages` unmittelbar vor neuem Abschluss und Wiederholung. Der erste Abschnitt verlangt genau eine exakte Kurzmeldung mit Zusatz; der zweite wartet auf den fachlichen No-op-Text und verlangt das Fehlen des Zusatzes. Status `already_committed`, globale Altmeldungen oder der aktuelle Inhalt des Meldungscontainers allein belegen keinen neuen Erfolg. State-/Registryabgleich, Sperren, zweiter Jahresknopf und Reload bleiben Bestandteil des Falls.

Das separate Browsergate (`npm run test:browser`) erweitert `Balance wealth history` um Markup ohne JavaScript, initiales Jahres-Update bei leerem/gefülltem Verlauf, vier Tabs, Klick/Enter/Leertaste, aktive Capturetaste mit direkter Fokusfolge in Diagramm/Tabelle, inaktive unfokussierbare Regionen, Tagesersetzung/neuen Tag, Datum, Reload und echte Profilnavigation. Verlaufimport/Ablehnung/Legacy und ein injizierter UI-Lesefehler nach echtem Replace prüfen aktiv und inaktiv die bestätigte Datenbasis ohne Tabwechsel; Nachrichtenindizes verhindern alte Erfolgs-/Fehlermeldungen als Nachweis. Tabwechsel werden mit Update-/Fehlerbereinigungs-/Schreibzählern, null Mutationen beider Browser-Speicher, deren sortierten Schlüssel-/Wertvergleichen und State-/Registry-/Exportvergleichen geprüft. Ausstehende entprellte Inputupdates werden über ihren tatsächlichen Abschluss beobachtet. Eine eigene synthetische Fixture mit 24 Ständen und 24 Ausgabenjahren misst bei 1250, 1251, 1280, 1366, 1440, 1600 und 1920 CSS-Pixeln dieselbe gefüllte Datenbasis: aktive Ausgabentabelle, Tabellenbreite und deren durch Wrapper/Viewport/Überlaufvorfahren tatsächlich sichtbare Breite, Wrapperbreite, Formularbreite vor/nach Öffnen des Verlaufs, Seitenbreite, Tabrechtecke samt Textzeilen und gemeinsame Desktop-Aktionszeile. Über 1250 px muss die mindestens 720 px breite Ausgabentabelle vollständig sichtbar sein und alle vier Titel müssen vollständig und einzeilig bleiben; ab 1366 px stehen sie zusätzlich in einer gemeinsamen Tabzeile. 1250/1251 prüft die bestehende Layoutgrenze. Messungen warten auf beobachtetes Idle, geladene Schriften, Animationsende und Layoutframes; die Rundungstoleranz beträgt höchstens 1 CSS-Pixel. Bei 375 CSS-Pixeln werden alle vier Tabs und Capture, kein seitenweiter horizontaler Überlauf und tatsächlich intern scrollende SVG-/Tabellenregionen sowie der bestehende Drawer geschlossen/geöffnet/wieder geschlossen geprüft. Der Nullstand behält seine separate Mobil-/Fokusprüfung. Die Ausgabe `Balance wealth layout SOURCE` liefert echte JSON-Messwerte für den Browserbericht der gesteuerten Sitzung; Review-Vorherwerte ersetzen keinen neuen Lauf. Der Vergleich zu `main` erfolgt dort lesend oder über eine getrennte Scratch-Fixture. `Balance annual commit` führt weiterhin zwei neue Abschlüsse 2026 bei aktivem/inaktivem Verlauf mit State-/Registryabgleich, Sperren, No-op und Reload durch. Sandboxfehler beim Server-/Browserstart sind kein grüner Browsernachweis; die volle Node-Suite führt im orchestrierten Lauf allein der Orchestrator aus; das Browsergate fährt die gesteuerte Sitzung außerhalb der Sandbox vor dem Merge.

Fokussierte Ausführung:

```bash
node tests/run-single.mjs tests/wealth-history-contract.test.mjs
node tests/run-single.mjs tests/balance-wealth-history.test.mjs
node tests/run-single.mjs tests/balance-wealth-history-chart.test.mjs
node tests/run-single.mjs tests/balance-annual-workflow-contract.test.mjs
```

#### `balance-smoke.test.mjs`
**Zweck:** End-to-End Smoke-Test der Balance-App ohne JSDOM.
- Initialisierung über DOMContentLoaded
- EngineAPI.simulateSingleYear wird beim Init aufgerufen
- Input-Änderungen triggern debounced Update
- Footer zeigt Engine-Version

#### `balance-reader.test.mjs`
**Zweck:** Testet das DOM-Input-Lesen.
- **readAllInputs:** Basis DOM-Werte, Währungsformatierung
- **Profile-Overrides:** localStorage überschreibt DOM-Werte
- **Gold-Modul Defaults:** Fallback auf 7,5% Ziel, 1% Floor, 25% Band
- **Tranchen-Aggregation:** Automatische Summenbildung aus depot_tranchen
- **Sonstige Einkünfte:** Addition zu Rente
- **applyStoredInputs:** Checkbox, Currency-Formatierung, Boolean → ja/nein
- **applySideEffectsFromInputs:** Gold-Panel Visibility, Rente disabled

#### `balance-storage.test.mjs`
**Zweck:** Testet die localStorage-Persistenz.
- **saveState/loadState:** JSON-Serialisierung, Rundtrip-Integrität
- **Migrations:** Ungültiger cumulativeInflationFactor (>3 → 1), NaN-Handling
- **Migration-Flag:** Läuft nur einmal
- **resetState:** Vollständige Bereinigung
- **createSnapshot:** full-localstorage Format, Label in Key
- **restoreSnapshot:** Wiederherstellung aller Keys
- **deleteSnapshot:** Entfernung aus localStorage
- **Fehlerbehandlung:** Ungültiges JSON, leerer Storage

#### `balance-storage-contract.test.mjs`
**Zweck:** Testet reale StorageManager-Contracts gegen `app/balance/balance-storage.js`.
- **Migration:** Inflations-State wird bereinigt und Migrations-Flag gesetzt
- **TaxState:** `lastState.taxState.lossCarry` wird ergänzt, repariert oder erhalten
- **StorageError:** Ungültiges State-JSON wirft den echten Fehler-Typ
- **Restore-Filter:** Full-localStorage-Restore übernimmt nur erlaubte App-Keys
- **Snapshot:** `createSnapshot()` schreibt Full-localStorage-Payload mit bereinigtem Label

#### `balance-annual-inflation.test.mjs`
**Zweck:** Testet die jährliche Inflationsanpassung.
- **Kumulative Inflation:** 2% über 10 Jahre → Faktor ~1.22
- **Bedarfsanpassung:** Floor und Flex werden skaliert
- **Negative Inflation:** Wird ignoriert (kein Faktor-Rückgang)
- **lastInflationAppliedAtAge:** Tracking des letzten Anwendungsalters

#### `balance-annual-workflow-contract.test.mjs`
**Zweck:** Testet die operativen Jahresworkflow-Contracts.
- **Jahresupdate-Orchestrator:** Reihenfolge Alter → Inflation → ETF → CAPE → Update
- **Result-Shape:** CAPE-Fehlerdetails, altes/neues Alter, gespeichertes Log
- **Profil-Save:** Jahresupdate schreibt den aktuellen Profil-Snapshot
- **Jahresabschluss:** bestätigter Recovery-Snapshot vor fachlichen Jahresmutationen; finale Bestätigung nach Jahresfortschreibung, Ausgaben-Rollover und periodengebundenem State-Commit
- **Snapshot-Refresh:** Snapshot-Liste wird nach Abschluss neu gerendert

#### `balance-binder-snapshots.test.mjs`
**Zweck:** Testet Snapshot-Erstellung und -Wiederherstellung.
- **Jahresabschluss:** Erstellt vollständigen Snapshot (inputs + tranchen + state)
- **Label in Key:** Profilname wird im Snapshot-Key gespeichert
- **Restore:** Stellt alle localStorage-Daten wieder her
- **Fehlerbehandlung:** Broken Snapshots werden abgefangen
- **Multiple Snapshots:** Koexistenz mehrerer Snapshots

#### `balance-diagnosis-chips.test.mjs`
**Zweck:** Testet UI-Chip-Komponenten für Diagnose.
- **formatChipValue:** Null/undefined/leerer String → Fallback
- **getChipColor:** Threshold-basierte Farbzuordnung (ok/warn/danger)
- **createChip:** DOM-Struktur mit Status-Klasse und Tooltip

#### `balance-diagnosis-copy-contract.test.mjs`
**Zweck:** Testet den kopierbaren Diagnose-Exporttext.
- **Statusblock:** Status-Übersicht wird nicht doppelt ausgegeben
- **Transaktionsdiagnostik:** Blockgrund, geplante Aktion und Grenzwerte werden lesbar exportiert
- **Dynamic Flex:** VPW-Block, Sicherheitsmodus und Warnsignale bleiben im Copytext erhalten

#### `balance-diagnosis-decision-tree.test.mjs`
**Zweck:** Testet den Entscheidungsbaum für Diagnose.
- Überschuss → "Investieren"
- Unterdeckung → "Verkaufen"
- Gold über Limit → "Gold reduzieren"
- Liquidität kritisch → "Notfall-Refill"
- Neutral → "Keine Aktion nötig"
- Severity-Klasse bei Guardrail-Eingriff

#### `balance-diagnosis-guardrails.test.mjs`
**Zweck:** Testet Guardrail-Chip-Rendering.
- Bear Market Chip bei regime bear_*
- Runway Warning bei <75%
- Alarm Chip bei activeAlarm > 0
- Refill-Cap Hint im Bear Market
- Korrekte Farbcodierung (ok/warn/danger)

#### `balance-diagnosis-format.test.mjs`
**Zweck:** Testet Normalisierung der Entscheidungsdiagnose.
- Exakt erreichte Mindestschwellen werden als ok bewertet
- Grenzfallhinweise wie „Exakt auf Mindestniveau“ werden gesetzt
- Knappe Sicherheitsabstände bleiben warn

#### `balance-diagnosis-transaction.test.mjs`
**Zweck:** Testet Transaktions-Diagnose-Rendering.
- Empty State bei null-Diagnostics
- Guardrail-Block → danger Status
- Cap active → warn Status
- Tranchenauswahl-Rendering mit Details
- Gold-„Warum nicht?“-Hinweis bei sichtbarem Ziel ohne Goldkauf

#### `balance-flex-trace.test.mjs`
**Zweck:** Echte Planner-/Engine-Monatsketten und schreibfreie Warum-Bedienung.
- S-Kurve im heißen Markt, Bärenkürzung mit Mindest-Flex-Anhebung, Vollfinanzierung, fehlender Trace/Bedarf.
- Rentenüberschuss und Dynamic Flex einschließlich nicht-ganzzahliger Bedarfe; Kettenabgleich auf Rohwertebene und richtungstreue Balken.
- Wiederholtes Öffnen/Schließen, idempotente Bindung und Rücksetzen beim Ergebnis-/Profilrender; keine Speicherwrites.
- Gezielter Lauf: `node tests/run-single.mjs tests/balance-flex-trace.test.mjs`. Keine neuen Browserfälle; Bild-/EXE-Abnahme bei 1920/2560 durch die Steuerung weiterhin ausstehend.

#### `balance-renderer-summary.test.mjs`
**Zweck:** Testet Summary-Rendering.
- formatCurrency: Euro-Symbol
- calculateTotals: Werte werden preserved
- renderSummary: DOM-Updates mit Formatierung

### Pflegebucket-Diagnose
**Dateien:** `balance-health-bucket.test.mjs`, `balance-decumulation.test.mjs`, `balance-diagnosis-keyparams.test.mjs`, `balance-diagnosis-copy-contract.test.mjs`, `balance-renderer-summary.test.mjs`, `balance-smoke.test.mjs`

**Zweck:** Sichert die Balance-App als reinen Consumer der Pflegebucket-Profildefinition.
- **Diagnosewerte:** Brutto-Liquiditaet, Pflege-Zweckbindung, operative Liquiditaet, Zieldeckung und Ziel-Luecke.
- **Policy:** `releasePolicy='diagnostic_only'`, `releaseAllowed=false`, `releasedAmount=0`.
- **UI/Copytext:** Summary, Key-Parameter und Diagnose-Export weisen die Zweckbindung und die fehlende automatische Freigabe aus.

### 7. Simulator Module

#### `simulation.test.mjs`
**Zweck:** Integration der vollständigen Simulationsschleife.
- simulateOneYear mit verschiedenen Szenarien
- Portfolio-Updates über Jahresschritte
- Validierung der Ergebnisstruktur

#### `simulator-headless.test.mjs`
**Zweck:** Headless Full-Backtest ohne Browser.
- 2000-2025 Simulation mit realen Marktdaten
- Validiert dass Liquidität nie negativ wird
- State-Persistence über Jahre hinweg

#### `simulator-backtest.test.mjs`
**Zweck:** Testet die historische Backtest-Funktion.
- **Determinismus:** Zwei Läufe mit gleichen Inputs sind identisch
- **Startjahr-Filterung:** Korrekte Jahr-Auswahl (2010-2012)
- **Historische Daten:** D-01-konforme Inflation aus `HISTORICAL_DATA[t]`
- **yearlyResults:** Länge entspricht (end-start+1)
- **finalWealth:** Stimmt mit letztem Jahreseintrag überein
- **Mindest-Flex:** Stresstest 2005-2014 mit lokalem Same-Year-Invariant bei Status `applied`, Logstatus und FlowDelta-Pruefung inklusive 3-Bucket-Modus.
- **Profilverbund-Transparenz:** Backtest-Ergebnis behaelt die profilgenaue `minimumFlexProfiles`-Aufteilung.
- **Realentnahme:** Historische Jahreszeilen führen den kumulierten Inflationsfaktor fort und deflationieren die effektive Entnahme.
- **Zinsmarker:** Hochzins 2000, der EONIA-/EURSTR-Uebergang 2019 und das
  reine negative EURSTR-Jahr 2020 werden vom generierten Quellenwert ueber
  `cashBondReturn` bis zur exakten Zinsgutschrift im Balance-Trace
  nachgerechnet; `portfolio_flow_delta` bleibt jeweils null.

#### `simulator-backtest-ui.test.mjs`
**Zweck:** Testet den DOM-armen UI-/Accessibility-Vertrag des historischen Backtests.
- **Zeitraum:** Provider-Bounds, sichtbarer Datensatzhinweis, Einjahreslauf sowie leere, NaN-, nicht-ganzzahlige, rueckwaertige und out-of-bounds Felder.
- **Inline/Fokus:** Feldzuordnung, `aria-invalid`, sichtbarer Fehler und Fokus auf das erste ungueltige Feld.
- **Statussicherheit:** Stabiler technischer Code ohne Stack oder lokalen Pfad; terminaler Fokus und maschinenlesbarer Status.
- **Datenqualitaet/A11y:** Inventar der Observation-Qualitaetsmarker, Caption, `scope="col"`, verstaendliche Headerlabels und HTML-Escaping.
- **Cohorts:** Tief eingefrorener UI-/Exportsnapshot, feste Horizontlaenge, Ausschlussgruende und `eligible=0` ohne `NaN`/`Infinity`.

#### `historical-backtest-runner.test.mjs`
**Zweck:** Testet den DOM-freien historischen Runner direkt an seiner Dependency-Injection-Grenze.
- **Request/Result:** `BacktestRequestV1` und `BacktestRunResultV1` inklusive Zeitraum, `breakOnRuin`, Dataset-/Temporal-/Engineprovenienz, diskriminiertem Outcome, Rows, Completion, Portfolio-Snapshots, Metriken und Summary.
- **Isolation:** Lauf unter blockierten Browser-/Persistenzglobals; alle benoetigten Funktionen und historischen Records werden explizit injiziert.
- **Non-Mutation:** Tief eingefrorene Partner-/Trancheninputs und Historienrecords, wiederholter identischer Aufruf sowie Erhalt von `undefined`, `Date`, `RegExp` und zyklischen Referenzen.
- **Contractintegration:** Validierte Records, initiale Vierjahres-Markthistorie, D-01-`yearData`, fail-closed `incomplete` vor dem Loop sowie reconciliierte `completed`-/`ruin`-/`technical_error`-Pfade.

#### `historical-backtest-contract.test.mjs`
**Zweck:** Testet den im Produktbacktest aktiven V1-Daten-/Jahrescontract ohne DOM.
- **YearRecord:** Realized-/Decision-as-of-Trennung, Source-/As-of-Jahre, Qualitaet und aktive D-01-Konvention `realized_t_decision_t_minus_1_v1`.
- **Preflight:** Einjahreslauf, Integer-/Bounds-Vertrag, erste Lookback-/Periodenluecke und Cohort-Batch.
- **Fehler:** Strukturierte Missing-/Non-Finite-/Indexlevel-/Fallback-Zero-Fehler.
- **Instrumentation:** Vollvalidierung einmal je Revision/Hash und Preflight einmal je Request/Batch; wiederholte Year-/MC-/Sweep-/Cohort-Lookups bleiben reine Cache-Reads.
- **Marker:** Rentenanpassungs-Offset fuer 1950, 2000 und 2001 sowie maschinenlesbares Builderinventar.

#### `historical-data-manifest.test.mjs`
**Zweck:** Testet `HistoricalDataManifestV1` und den eingebetteten Datenfingerprint.
- **Manifestfelder:** IDs, Variante, Waehrung, Region, Frequenz, Zeitraum, Source-/Lizenzstatus, Transformation, Schaetzsegmente, Missingness und Revision.
- **Resolution-Gate:** Belegte Aktien- und VPI-Source-/Lizenzfelder bleiben `known`; fuer die verbleibenden Reihen gibt es keine leeren `known`-Werte und keine erfundenen Werte unter `unresolved`.
- **Hash:** Browser-kompatibles SHA-256 gegen Node-`crypto` und den manifestierten Laufzeit-Datenbestand.
- **Lookup:** Lueckenlose 1925-2025-Baseline, abgeleitete technische Bounds 1929-2025, Provenienz und Non-Mutation.

#### `global-equity-research-chain.test.mjs`
**Zweck:** Testet die generierte offene 1925-2025-Aktien-Forschungsproxykette.
- **Quellenhashes:** Originale und gefilterte JST-/OECD-/EZB-Eingaben stimmen mit den gepinnten SHA-256-Werten ueberein; der Build rekonstruiert die Filterung bytegenau.
- **Verkettung:** 101 Jahresreturns und Levels sind lueckenlos, positiv und genau einmal verkettet; `HISTORICAL_DATA` verwendet ausschliesslich diese Levels.
- **Vollnachrechnung:** Ein unabhaengiger Testpfad rekonstruiert alle 101
  Returns direkt aus den Filtereingaben; 1950 bleibt USD-basiert, der
  deutsche Anleger-Numeraire beginnt 1951.
- **Lueckenvertrag:** Deutsche Wechselkursluecke 1945-1946 und japanische Aktienluecke 1946-1947 bleiben maschinenlesbar.
- **Evidenz:** `proxy`, `backtested` und `estimated` bleiben getrennt; moderne Referenzjahre und Datenhashes sind stabil.
- **Identitaet/Lizenz:** Kein MSCI-Anspruch; das generierte Artefakt traegt den separaten JST-Datenlizenzhinweis.
- **Inventarbruecke:** Alle sechs Runtime-Reihen sind mit eigenem Wert-Hash und
  Qualitaetssegmenten in `SimulationDataInventoryV1` verknuepft.

#### `global-equity-backtest-delta.test.mjs`
**Zweck:** Validiert den maschinenlesbaren Vorher-/Nachher-Vertrag aller sechs
bestehenden Zielreferenzen sowie eines zusaetzlichen Laufs ueber die
1949/1950/1951-Naht.
- **Konstanz:** Eingabe-Hashes und Outcome-Klassen bleiben unveraendert.
- **Deltas:** Endvermoegen, Entnahmen, Steuern, Kuerzungsjahre/-serie und
  FlowDelta besitzen jeweils die Ursache `global_equity_research_chain`.
  Neu instrumentierte Drawdown-/Runway-Werte sind getrennt als
  retroberechnete Zusatzdiagnostik markiert und keine Basisfixture-Oracles.
- **Bilanzgate:** Vorher und nachher bleibt der maximale absolute
  `portfolio_flow_delta` unter 1 EUR.

#### `german-cpi-chain.test.mjs`
**Zweck:** Testet die generierte deutsche 1925-2025-VPI-Kette.
- **Quellenhashes:** JST-R6-Original, Destatis-Langreihen-XLSX und aktueller
  Destatis-HTML-Snapshot stimmen mit ihren gepinnten SHA-256-Werten ueberein.
- **Verkettung:** 101 Jahresraten und synthetische Levels sind lueckenlos;
  `HISTORICAL_DATA` und `annualData` verwenden ausschliesslich die generierten
  Raten.
- **Naehte:** 1949/1950, 1962/1963, 1991/1992 und 2024/2025 besitzen feste
  Quellen-/Gebietsvertraege; 2024 und 2025 betragen jeweils 2,2 Prozent.
- **Evidenz/Lizenz:** JST-Proxy, amtliche Destatis-Segmente,
  `proxy_population`, HICP/HVPI-Ausschluss und beide Datenlizenzen bleiben
  maschinenlesbar.

#### `german-cpi-source-reconstruction.test.mjs`
**Zweck:** Fuehrt den read-only Original-zu-Modul-Rekonstruktionscheck aus und
beweist, dass das Verifikationsgate das generierte Modul nicht umschreibt.

#### `german-cpi-backtest-delta.test.mjs`
**Zweck:** Validiert die Slice-03-Vorher-/Nachher-Evidenz gegen den eingefrorenen
Post-Slice-02-Zielstand und das aktive Backtest-Ziel.
- **Identitaet:** Referenzen werden mit ID und Periode identifiziert;
  Input-Hashes und Outcome-Klassen bleiben stabil.
- **Deltas:** Endvermoegen, Entnahmen, Steuern, Kuerzungsmetriken,
  Drawdown, Runway und FlowDelta tragen die alleinige Ursache
  `german_cpi_chain`.
- **D-20:** Die isolierte Endjahreskorrektur 2024 haelt nominales
  Endvermoegen konstant und erklaert die dokumentierten +7.758,95 EUR
  Realwert rein aus dem Deflator.
- **Bilanzgate:** Vorher und nachher bleibt der maximale absolute
  `portfolio_flow_delta` unter 1 EUR.

#### `german-cash-money-market-chain.test.mjs`
**Zweck:** Testet die generierte deutsche 1925-2025-Cash-/
Overnight-Geldmarktproxykette.
- **Quellenhashes:** JST-R6-Original, Bundesbank-Langreihen-PDF und
  mechanischer Layout-Extrakt stimmen mit den gepinnten SHA-256-Werten
  ueberein. Der Rohdatenhash umfasst nur die beiden Primaerquellen; der
  abgeleitete Extrakt besitzt einen getrennten Hash.
- **Laufzeit:** 101 endliche Jahreswerte werden ausschliesslich aus dem
  generierten Modul in `HISTORICAL_DATA` und `annualData` projiziert.
- **Naehte:** JST, Schaetzbruecke, Frankfurt-Tagesgeld, FIBOR, EONIA,
  Uebergang 2019 und EURSTR besitzen feste Segmentgrenzen; Negativzinsen
  bleiben signiert.
- **Qualifikation:** Die 1949-1996-Werte sind wegen der nicht amtlich
  festgesetzten oder quotierten Meldesaetze als `proxy` klassifiziert.
  Meldergruppen-, Zinstage-, FIBOR- und EURSTR-Uebergaenge, die nicht
  modellierte Geldvermoegensabschreibung 1948 sowie der EZB-
  Administratorhinweis sind maschinenlesbar.
- **Anwendungsgrenze:** Der einfache Brutto-Jahresproxy wird vom bestehenden
  `cashBondReturn` auf Cash, Geldmarkt, Pflegebucket und Anleihetranchen
  angewandt. Fuer Anleihen bildet er weder Duration, Laufzeitpraemie,
  Kreditrisiko noch Mark-to-Market ab; zusaetzliche Aufzinsung,
  Produktkosten und Steuer sind ausgeschlossen.

#### `german-cash-money-market-source-reconstruction.test.mjs`
**Zweck:** Rekonstruiert alle 101 Werte unabhaengig aus dem JST-Original und
direkt aus der gepinnten Bundesbank-PDF. Ein eigenstaendiger
koordinatenbasierter `pdftohtml`-Reader prueft 77 Jahreswerte gegen das
Generatorartefakt, die einzige erlaubte 1945-1948-Luecke und das schreibfreie
Verifikationsgate; der abgeleitete Layout-Extrakt ist nicht das Oracle.
Poppler `pdftohtml` ab Version 25.07.0 ist deshalb eine fail-closed
Testvoraussetzung. Das Programm wird ueber `PATH`,
`RUHESTANDSAPP_POPPLER_BIN` oder `RUHESTANDSAPP_PDFTOHTML` aufgeloest;
`npm run verify:poppler-toolchain` prueft die Installation. Der Test bindet
nicht an eine konkrete Patchversion oder einen lokalen WinGet-Paketpfad. Er
ist als Windows-Gate klassifiziert und wird unter WSL/Linux in der
Standardsuite sichtbar als separates Gate ausgewiesen.

#### `german-cash-money-market-backtest-delta.test.mjs`
**Zweck:** Validiert die Slice-04-Vorher-/Nachher-Evidenz gegen den
eingefrorenen Post-Slice-03-Zielstand und die archivierte, byteidentische
Post-Slice-04-Zielkopie.
- **Identitaet:** Input-Hashes und Outcome-Klassen aller sieben
  Referenzfaelle bleiben stabil.
- **Deltas:** Vermoegen, Entnahmen, Steuern, Kuerzungsmetriken, Drawdown,
  Runway und FlowDelta tragen die alleinige Ursache
  `german_cash_money_market_chain`.
- **Marker:** Backtest und Monte Carlo verwenden in 2000/2001 denselben
  generierten aktuellen Jahreswert; der Legacy-Vergleich bleibt sichtbar
  `t-1`. Die Runtime-Zinsgutschrift wird zusaetzlich fuer Hochzins 2000,
  Uebergang 2019 und negatives EURSTR 2020 bis zum FlowDelta nachgerechnet.
- **Bilanzgate:** Vorher und nachher bleibt der maximale absolute
  `portfolio_flow_delta` unter 1 EUR.

#### `gold-german-investor-chain.test.mjs`
**Zweck:** Testet die generierte 1925-2025-Goldkette in deutscher
Anlegerwaehrung.
- **Quellenidentitaet:** JST-R6-XLSX, zwei Bundesbank-SDMX-CSV-Snapshots und
  World-Bank-Pink-Sheet-XLSX stimmen mit den gepinnten SHA-256-Werten
  ueberein.
- **Rekonstruktion:** 101 endliche Jahresreturns werden ausschliesslich aus
  dem generierten Modul in `HISTORICAL_DATA` und `annualData` projiziert;
  Markerformeln pruefen den offiziellen RFC-Jahresendanker 1933, den
  gesetzlichen 1934-Anker sowie Frankfurt- und EUR-Naehte unabhaengig. Die
  Zeitkonvention trennt Jahresend-, Teiljahres- und Jahresdurchschnittsregime.
- **Nullwerte:** Alle zwoelf literal verbleibenden Nullen tragen eine
  source-derived oder explizit estimated Erklaerung. Abgeleitete Nullen
  muessen Gleichheit beider Quellkomponenten belegen; unklassifizierte Nullen
  und Fallback-Zero-Segmente sind verboten.
- **Anwendung:** Der Goldreturn wird genau einmal auf den Goldbestand
  angewandt. Produktaufschlag, Spread, Verwahrung, Steuer und Tracking sind
  nicht Teil der Datenreihe.

#### `gold-german-investor-backtest-delta.test.mjs`
**Zweck:** Validiert die isolierte Slice-05-Vorher-/Nachher-Evidenz.
- **Goldfreie Invarianz:** Alle sieben festen goldfreien
  Charakterisierungsfaelle behalten Finanzmetriken, Outcomes und FlowDelta
  exakt; abweichende Row-Hashes entstehen nur durch diagnostische
  Goldreturnfelder.
- **Gold-Witness:** Ein echter sechsjaehriger UI-/Provider-/Backtestlauf
  2000-2005 mit 200.000 EUR Start-Gold und aktivem Zehn-Prozent-Ziel wird
  einmal gegen die Slice-04-Goldwerte und einmal gegen die aktuelle Kette
  ausgefuehrt. Acht Finanzmetriken, Outcomes, Row-Hashes und FlowDelta werden
  vorher/nachher eingefroren; mindestens ein Finanzwert muss sich wirksam
  aendern.

#### `simulation-data-inventory.test.mjs`
**Zweck:** Testet das simulationsweite Evidenzinventar und seine Quell-Gates.
- **Historieninventar:** Sechs eigene, lueckenlose 1925-2025-Segmentvertraege
  einschliesslich der aufgeloesten Aktien-, VPI-, Cash-/Geldmarkt- und
  Gold-Quellketten.
- **Statische Klassen:** Demografie, Pflege, Hinterbliebene, Steuern/Tranchen,
  Rente/Sozialversicherung, Stress/Regime und Default-/Fallbackwerte besitzen
  Implementierungsabdeckung und getrennte Evidenzklassen.
- **Wertfingerprints:** Historienreihen und exportierte statische Daten werden
  kanonisch gegen SHA-256 geprueft; lokale UI-/Steuerdefaults werden gegen
  ihre produktiven Quellen abgeglichen.
- **Negativ-Gates:** Erfundenes `unresolved`, unbelegte externe Validierung und
  statische Wertdrift schlagen fail-closed fehl.

#### `german-demography-care-survivor-contract.test.mjs`
**Zweck:** Validiert den generierten Demografie-/Pflege-/Hinterbliebenenvertrag.
- **Sterblichkeit:** Perioden- statt Kohortensemantik, Destatis-Periode
  2023/2025, Mann/Frau/divers-Marker, offizieller Altersbereich 18-100,
  expliziter Modellrand 101-110 und fehlende kuenftige
  Mortalitaetsverbesserung.
- **Pflege:** Amtliche Bestandszahlen/Praevalenzen bleiben
  `context_only_not_runtime_validation_or_transition_probability` (ohne
  Laufzeitvalidierung); Eintritt Grad 1/2,
  Progression und Dauer sind getrennte Modellannahmen.
- **Hinterbliebene:** `percent`/55 entspricht dem UI-Default, bleibt aber
  ausdruecklich keine gesetzliche Anspruchsberechnung.
- **Runtime/Diagnose:** Re-Exports und
  `DemographyCareSurvivorDiagnosticsV1` tragen Revision, Hashes und
  Aussagegrenzen; das Verify-Gate rekonstruiert byteidentisch.

#### `german-demography-care-survivor-source-reconstruction.test.mjs`
**Zweck:** Rekonstruiert mit einem separaten ZIP/XML-Leser alle 166 amtlichen
Runtime-`qx` fuer Mann/Frau und Alter 18-100 direkt aus dem gepinnten
Destatis-Workbook. Zusaetzlich werden Pflege-Gesamtbestand, alle fuenf
Pflegegradbestaende und 21 Alters-/Geschlechts-Praevalenzmarker aus dem
zweiten Original nachgerechnet.

#### `demography-care-survivor-runtime-measurement.test.mjs`
**Zweck:** Berechnet das stochastische 2.048-Run-/40-Jahres-Profil mit festem
Seed in jedem Lauf live. Der Test kann weiterhin einen Vergleichsstand ueber
`DEMOGRAPHY_MEASUREMENT_RUNTIME_ROOT` laden, aktiviert Pflege, Partner und
55-Prozent-Hinterbliebenen-Cashflow und vergleicht Monte Carlo sowie zwei
Sweep-Kombinationen vollstaendig mit der Slice-19-Zielfixture. Die neue Datei
bindet die unveraenderte Slice-17-Eingangsgrenze per SHA-256 und versioniert den
Vor-Auszahlungs-Runway sowie die korrigierte Monatsmetrik des Sweeps. Die
Slice-17-Datei bindet weiterhin den unveraenderten Slice-10-Eingang. Das
bytegeschuetzte `post-backtest-data-07-v1` bleibt eine unabhaengige Quelle fuer
die stabilen Slice-07-Demografieinvarianten; Runtime, Hashkette und aktive
Pflege-/Todes-/Hinterbliebenenpfade werden getrennt geprueft.

#### `historical-backtest-metrics.test.mjs`
**Zweck:** Testet das vollstaendige `HistoricalBacktestMetricsV3`-Woerterbuch und die reine Ableitung aus kanonischen Rohzeilen.
- **Definitionen:** Eindeutige IDs, Einheiten, nominal/real-Basis, Nenner, Rundung, Missingness, Outcome-Regel und Rohquellen fuer alle 29 Metriken.
- **Reconciliation:** Start-/Endvermoegen, reale Werte, Entnahmen, Floor-Shortfall, Haushalts-Flexbedarf/-Erfuellung, inklusive `>= 10 %`-Haushalts-Flexgrenze, finaler Mindest-Flex-Fehlbetrag, nullable Runway der Phase `after_transaction_before_payout`, Drawdown, Steuern, Verlusttopf, Pflegebucket und Outcome-Indikatoren. Gemischte oder fehlende Runway-Phasen invalidieren das Aggregat; terminale Ruinzeilen werden nicht als Null-Prozent-Stressjahr gezaehlt. Historische Rohzeilen ohne Haushaltsquote nutzen kontrolliert den Legacy-Kuerzungswert.
- **Fehlerpfade:** `incomplete`/`technical_error` erhalten keine erfundenen Finanzmetriken; Ruin behaelt additive Floor-Deckungsdiagnostik.

#### `historical-backtest-cohorts.test.mjs`
**Zweck:** Testet `HistoricalBacktestCohortsV1` und feste ueberlappende In-sample-Fenster.
- **Fenstervertrag:** Positive ganzzahlige inklusive Horizontlaenge, alle Kandidaten, `insufficient_horizon` fuer spaete Fenster und `yearIndex=0` je Cohort.
- **Batch/Outcomes:** Ein Provider-Batch-Preflight, keine Doppelvalidierung ueberlappender Jahre sowie getrennte Inventare fuer alle Outcomes und Ausschluesse.
- **Aussagegrenze:** Keine Erfolgswahrscheinlichkeit oder Unabhaengigkeitsbehauptung; Null-Eligible-Raten bleiben `null`.

#### `historical-backtest-export.test.mjs`
**Zweck:** Testet `HistoricalBacktestExportV2`, `HistoricalBacktestInputSemanticsV2` und die feste technische CSV-Projektion.
- **Reproduktion:** Request-/Result-Fingerprint, inklusive Periode, Dataset-/Manifest-/Temporal-/Engine-/Source-Commit-Provenienz, nicht restartfaehige aggregierte Portfolio-Grenzen, Quantisierungs-/Eingabesemantik, Records, Rows, Metriken und optionales Cohort-Inventar.
- **Stabilitaet:** Exportzeitpunkt und Detailtoggle aendern den Result-Fingerprint nicht; Source-Commit, Datenrevision, Quantisierung und kanonische Endsumme sind fingerprintwirksam. Fehlende/dirty Provenienz und widerspruechliche Endsumme scheitern fail-closed.
- **CSV/Sicherheit:** `HistoricalBacktestCsvV2` mit 34 festen Spalten einschliesslich der neuen fuehrenden, mit Raw-JSON geteilten kanonischen `run_id`, getrennte Haushalts-/Renten-/Depot-Flexbasis, finaler Mindest-Flex samt Fehlbetrag, Pflegebucket-inclusive Portfoliogrenzen, Punktdezimalen, LF, leere Missingness, keine HTML-/Displayformatter und Schutz gegen Formel-, Quote-, Delimiter- und Zeilenumbruchinjektion.

#### `simulator-backtest-characterization.test.mjs`
**Zweck:** Vergleicht die unveraenderte Slice-01-Baseline `legacy_observed` mit dem separaten D-01-Zieloracle `target_expected`.
- **Golden Cases:** kurzer und langer Completed-Pfad, 3-Bucket/Mindest-Flex, der eigene D-17-Zeuge 2000-2010 mit Einzeljahren 2001/2005/2009/2010, Ruin, Pflegebucket-Projektionsluecke, Dynamic-Flex/CAPE, zwei lohnindexierte JST-Fenster 1930-1940 und 1935-1946 sowie der Lohnquellen-Nahtzeuge 1944-1950.
- **Negative Cases:** Einjahreslauf, NaN-/rueckwaertige Periode, mittlere Datenluecke und nicht-finite Goldrendite.
- **Messvertrag:** kanonische Input- und Row-Hashes, Non-Mutation, Metrikwoerterbuch, 2000/2001-Alignment sowie kontrollierte Abloesung von `legacy_schema_v0` durch `backtest_ui_state_v1`; Detailtoggle-Paritaet bleibt erhalten.
- **Delta-Gate:** `BacktestTemporalDeltaReportV1` benennt jede geaenderte Metrik samt Ursache und berichtet Endvermoegens-, Ruinfall- sowie Downstream-Consumer-Auswirkungen; nicht gespeicherte Zieldeltas schlagen fehl. `CapeWageBacktestDeltaEvidenceV3` bleibt als bytegehashtes Slice-06-Archiv erhalten. `DemographyCareSurvivorBacktestDeltaEvidenceV1` bindet den neuen Sterbetafelhash, den Lohnnahtzeugen und fuer aktiven sowie CAPE-inaktiven Arm den direkten Slice-06-zu-Slice-07-Vergleich mit zehn exakten Kennzahlen. `Slice07To08LiquidityRunwayBacktestDeltaV1` misst davon getrennt die echte Runway-Slice-Wirkung; der CAPE-an/aus-Effekt innerhalb des aktuellen Laufs bleibt ein drittes separates Orakel. Pflege/Hinterbliebene sind im deterministischen Backtest inaktiv.
- **Fixtures:** `fixtures/simulator-backtest-baseline-v1.json` und die bytegehashte Slice-06-V3-Evidenz bleiben read-only; `fixtures/simulator-backtest-target-v1.json` darf kontrolliert mit `UPDATE_BACKTEST_TARGET=1 node tests/run-single.mjs tests/simulator-backtest-characterization.test.mjs` erzeugt werden. Die Slice-07-Evidenz wird einmalig mit `CREATE_BACKTEST_DATA_07_DELTA=1` angelegt und danach nicht ueberschrieben. `fixtures/liquidity-runway-slice-08-measurement-v1.json` bleibt der unveraenderliche Slice-09-Eingang; `fixtures/minimum-flex-slice-09-measurement-v1.json` speichert getrennt das Slice-08-zu-09-Ledger und den D-17-Zeugen. Fuer CR10-14 belegt `minimum-flex-slice-09-added-case-financial-v1.json` die am Commit `2e4867f` nachgemessene Finanzbasis des zwoelften Falls; `node tests/reconstruct-slice09-d17.mjs` rekonstruiert diese Messung aus dem archivierten Commit. Das einzige autoritative 12/12-Ledger liegt als `Slice09To10FinancialDeltaLedgerV2` in `tax-logic-slice-10-backtest-measurement-v1.json` und ist unveraenderlich. `PRINT_BACKTEST_DATA_10=1` erlaubt nur eine lesende Diagnose; `UPDATE_BACKTEST_DATA_10=1` wird absichtlich blockiert.
- **Slice-13-Integration:** `fixtures/backtest-data-integration-slice-13-v1.json`
  pinnt acht echte Referenzfenster ab 1930, darunter ein dediziertes
  Stagflationsfenster 1970-1982 und ein Crashfenster 2007-2010, die
  SHA-256-Kette der Slice-2-bis-10-Deltaevidenzen und den inklusiven
  26-Jahres-Lauf 2000-2025. Die Finanzneutralitaet der Slices 11 bis 13 wird
  als Gleichheit des kanonischen 26-Jahres-Rowhashes gegen die Slice-12-Basis
  gemessen.
  Alle Referenzen muessen `portfolio_flow_delta < 1 EUR` halten. Der finale
  Raw-JSON-Export bleibt bis zum extern geprueften Slice-13-Commit gesperrt.
  Der Test misst Git-HEAD und Git-Status, bindet sie in die Runtime-Provenienz
  und erwartet im Dirty-Tree `HISTORICAL_EXPORT_SOURCE_TREE_DIRTY`; auf einem
  sauberen Commit muss dasselbe Gate in den erfolgreichen Exportzweig
  umschlagen und einen Result-Fingerprint liefern.
- **Slice-17-Runway-Basis:** Die neue Fixture
  `fixtures/liquidity-runway-basis-slice-17-measurement-v1.json` bindet den
  aktuellen vollstaendigen Charakterisierungshash und den erwarteten Delta-
  Zeugen des inklusiven 2000-2025-Integrationsfalls. Die Slice-13-Aussage zur
  damaligen Finanzneutralitaet bleibt in ihrer byteidentischen Eingangsfixture
  unveraendert. Aus der Slice-10-Grenze bleiben sowohl
  `crossSliceOracleProjection` als auch das vollstaendige Deltaledger durch
  exakte Runtime-Hashes gebunden; der aktuelle Runtimepfad darf sich nicht als
  die alte neutrale Grenze ausgeben.
- **Slice-14-Ergebnisvalidierung:**
  `backtest-data-validation-slice-14.test.mjs` verwendet das vollstaendige
  Slice-13-Ergebnisdokument als Eingangsgrenze. Die Fixture
  `fixtures/backtest-data-validation-slice-14-v1.json` pinnt den sauberen
  Slice-13-Commit `bbc25ab`, Ergebnisdokument und Integrationsfixture per
  SHA-256 sowie den finalen Exportfingerprint. Die separate Fixture
  `fixtures/backtest-data-validation-slice-14-fingerprint-basis-v1.json`
  enthaelt die vollstaendige kanonische Fingerprint-Basis; der Test berechnet
  den Fingerprint daraus mit dem produktiven Kanonisierungsvertrag neu. Er
  liest die Eingangsbytes und alle neun Attributionsevidenzen direkt aus dem
  archivierten Commit, prueft Ergebnisdokument und Integrationsfixture
  zusaetzlich im lebenden Arbeitsbaum, bindet aktive Daten und Manifest samt
  neu berechneten Hashes, verlangt Git-Erreichbarkeit und Vorfahrenbeziehung
  und prueft acht eindeutige inklusive Referenzperioden, vollstaendige
  Jahreszeilen, endliche Summen und endliches `FlowDelta < 1 EUR`.
  Die Slice-11-bis-13-Finanzneutralitaet wird ausdruecklich nicht als belegt
  behandelt, weil der Integrationsfall im Slice-12-Commit nicht existierte.
- **Slice-15-Datenpruefung:**
  `backtest-data-validation-slice-15.test.mjs` verwendet das vollstaendige
  Slice-14-Ergebnisdokument am sauberen Commit `619c4d4` als Eingangsgrenze.
  Die Fixture `fixtures/backtest-data-validation-slice-15-v1.json` pinnt
  Ergebnisdokument, Slice-14-Validierungsfixture und -test sowie die
  kanonische Fingerprintbasis per SHA-256. Der Test liest die unveraenderten
  Vorgaengerartefakte direkt aus dem Commit, protokolliert CR14-14/CR14-15
  ohne erneute Bytebindung des fortschreibbaren Slice-14-Dokuments und
  rekonstruiert Dataset-/Manifest- und Result-Fingerprint aus der
  bytegebundenen Live-Basis. Die sieben bereits
  vorhandenen Rekonstruktions-/Kettengates bleiben Owner der
  `verify:*data`-Builderausfuehrung; Slice 15 bindet Paketkommando, Skriptpfad,
  Gate-Datei und gefangene `spawnSync`-Prozessgrenze, ohne die
  Builder in `npm test` doppelt auszufuehren. Sieben zeilenendensensitive
  Originalquellen sind in `.gitattributes` als `binary` markiert. Vor dem
  Commit prueft das Gate den gemeinsamen Acht-Pfade-Kandidaten; nach dem
  Slice-Commit vergleicht es die tatsaechlichen HEAD-Blobbytes mit den
  gepinnten SHA-256-Werten. Der gemeinsame Slice-15-Commit `efd51ad` enthaelt
  den Binaervertrag und der Post-Commit-Pfad besteht mit 155/155 Assertions.
  Die offene
  Finanzneutralitaet gegen Slice 12 bleibt als
  `not_demonstrated_against_slice_12_commit` erhalten. Das versionierte
  Nachfolgerverfahren fuer Evidenzfortschreibungen ist dokumentiert, aber
  ausdruecklich nicht maschinell gegen autorisierte Fixtureaenderungen oder
  fehlendes externes Review erzwingbar. Repositoryinterne Rekonstruktion ist
  keine externe wissenschaftliche Validierung.
- **Slice-16-Datenpruefung:**
  `backtest-data-validation-slice-16.test.mjs` verwendet das vollstaendige
  Slice-15-Ergebnisdokument am sauberen Commit `efd51ad` als Eingangsgrenze.
  Die Fixture `fixtures/backtest-data-validation-slice-16-v1.json` bindet
  Ergebnisdokument, Slice-15-Fixture und Slice-15-Test per SHA-256 und prueft
  alle drei Pfade auch im lebenden Baum. Der CI-Checkout muss mit
  `fetch-depth: 0` die fuer Slices 14 bis 16 benoetigte Vorgaengerhistorie
  bereitstellen; das Gate isoliert den benannten Checkout-Schritt und prueft
  `fetch-depth: 0` nur in dessen eigenem `with`-Block. Der Test leitet alle
  textartigen Originalquellen unter `data/historical` und `data/static` aus
  Commit- und Live-Inventar ab, verlangt fuer die vollstaendige Menge
  Binaerattribute und vergleicht deren Bytes mit den gepinnten Hashes. Dataset
  und Manifest werden aus produktiven Daten neu
  berechnet. Der Result-Fingerprint belegt nur die Selbstkonsistenz der
  committeten kanonischen Archivbasis. Der lebende Engine-Nachweis bleibt
  unabhaengig beim Charakterisierungsgate; Slice 16 fuehrt ihn nicht erneut
  aus und bindet ihn nicht ueber Quelltext-Teilstrings. Die offenen Grenzen zur
  Slice-12-Finanzneutralitaet und zur externen wissenschaftlichen Validierung
  bleiben erhalten; Builder werden nicht doppelt ausgefuehrt.

#### `simulator-real-withdrawal-contract.test.mjs`
**Zweck:** Testet den Simulatorvertrag für echte Realentnahmen.
- dreijähriger synthetischer 10-%-Inflationsfall mit Faktoren `1 / 1,1 / 1,21`
- genau einmal fortgeschriebener App-State und Engine-`lastState`-Spiegel
- Ansparjahre und erstes Entnahmejahr beziehen sich auf die Kaufkraft des ersten Simulatorjahres
- deterministische MC-Log- und Realentnahmestichprobe verwenden denselben Faktorvertrag
- nominaler und realer MC-Maximum-Drawdown verwenden dieselben erfolgreichen Portfoliopunkte; die reale Serie deflationiert jeden Punkt mit dem zugehoerigen kumulierten Inflationsfaktor

#### `simulator-heatmap.test.mjs`
**Zweck:** Testet Heatmap-Rendering.
- **viridis:** Farbskala-Endpunkte (0 → dunkelviolett, 1 → gelb)
- **computeHeatmapStats:** Leere/einzelne Werte
- **renderHeatmapSVG:** Cell-Mapping, Legende
- **4,5-Prozent-Grenze:** Das exakt bei 4,5 Prozent beginnende Bin gehoert zur
  bin-basierten `>=`-Ueberlagerung; Basis, Operator und Berichtsrolle sind
  sichtbar und vom strikt-`>`-Gesamt-KPI getrennt
- **renderSweepHeatmapSVG:** Placeholder bei leeren Ergebnissen

#### `scenario-analyzer.test.mjs`
**Zweck:** Testet Szenario-Analyse und -Vergleich.
- **extractKeyMetrics:** Defaults, Typ-Coercion, NaN-Handling
- **analyzeScenario Tags:** care, failed, early_care, severe_cut, widow, crash
- **Tags aus logDataRows:** Erkennung von Events in Jahresdaten
- **compareScenarios:** Ranking nach Endvermögen, failed-Flag

#### `scenarios.test.mjs`
**Zweck:** End-to-End-Verifikation komplexer Lebenspfade.
- **Care Case:** Hohe Pflegekosten-Deckung
- **Widow/Survivor:** Rentenreduktions-Logik
- **Market Crash:** Notfall-Refill und Kapitalerhalt

### 8. Profilverbund (Multi-Profil)

#### `profile-storage.test.mjs`
**Zweck:** Testet das Profil-Registry-System.
- **Default Profile:** Automatische Erstellung bei leerem Storage
- **ensureProfileRegistry:** Idempotenz (nur 1 Default)
- **Slug-Konflikte:** Automatische Suffix-Generierung
- **Slug-Normalisierung:** Umlaute, Leerzeichen, Sonderzeichen entfernt
- **renameProfile:** Name-Update ohne ID-Änderung
- **deleteProfile:** Löschen, Schutz des letzten Profils, Switch nach Löschung
- **switchProfile:** Save/Load, Profile-scoped Keys werden gelöscht
- **getProfileMeta/Data:** Lesen einzelner Profile
- **updateProfileData:** Merge-Verhalten
- **belongsToHousehold:** Verbund-Mitgliedschaft
- **Export/Import:** Bundle-Format, Globals-Handling
- **Korrupte Daten:** Graceful fallback bei ungültigem JSON

#### `profilverbund-balance.test.mjs`
**Zweck:** Testet Balance-App Aggregation über Profile.
- **aggregateProfilverbundInputs:** Summenbildung (Bedarf, Renten, Depots)
- **calculateTaxPerEuro:** Steuerquote basierend auf Gewinnanteil
- **calculateWithdrawalDistribution:**
  - Proportional: Nach Depot-Anteil
  - Tax-optimized: Niedrigste Steuer zuerst
  - Runway-first: Nach Runway-Zielgewichten
  - Cash-first: Tagesgeld/Geldmarkt vor Tranchenauswahl
- **selectTranchesForSale:** FIFO + Steueroptimierung
- **Asset-Summaries:** Detailtranchen ersetzen aggregierte Assetwerte ohne Doppelzählung

#### `profilverbund-profile-gold-overrides.test.mjs`
**Zweck:** Testet Gold-Parameter-Overrides aus Profil-Storage.
- profile_gold_aktiv überschreibt inputs.goldAktiv
- profile_gold_ziel_pct überschreibt goldZielProzent
- Komma-Parsing für deutsche Zahlenformate (7,5 → 7.5)
- belongsToHousehold=false wird nicht geladen

#### `simulator-multiprofile-aggregation.test.mjs`
**Zweck:** Testet Simulator-Profile-Kombination.
- **combineSimulatorProfiles:** Vermögens-/Bedarfs-Summen
- Primary/Partner-Aufteilung bei 2 Profilen
- Warning bei >2 Profilen, während finanzielle Summen erhalten bleiben
- Detailtranchen-Merge mit profilbezogenen IDs und `sourceProfileId`
- Pflegebucket-Definition des Primary-Profils gilt als Haushaltsdefinition; abweichende sekundäre Definitionen erzeugen Warnungen
- Null-Marktwert-Tranchen fallen mit Warnung auf aggregierte Startwerte zurück
- Balance-Bedarfswerte haben Vorrang vor historischen `sim_`-Werten; diese
  bleiben nur Fallback, wenn der Balance-Wert fehlt

#### `simulator-household-needs-persistence.test.mjs`
**Zweck:** Testet den globalen Vertrag für manuelle Haushaltsbedarfs-Overrides.
- einmalige Migration eines vollständigen gültigen `sim_`-Altwert-Trios
- automatische Migration ausschließlich im sicher zuordenbaren
  Einprofil-Haushalt; Mehrprofilwerte bleiben bei der aggregierten Profilbasis
- früher `migration_pending`-Vertrag ohne Abhängigkeit vom erfolgreichen
  Profilverbund-Aufbau; ein fehlender Profilverbund blockiert Simulatorläufe
  sichtbar und fail-closed
- unabhängig kanonisierte feldbezogene Overrides und Präzedenz vor Profil-Summen
- native feldnahe Validierung ungültiger Eingaben, wirksame
  Mindest-Flex-/Flex-Invariante mit letztem wirksamen Nachbarwert, reloadfeste
  Eingabe-Zwischenstände und Ablehnung nicht exakt darstellbarer Großwerte
- exakte Schemaversion mit einmaliger Warnungsquittierung, Selbstheilung
  beschädigter V1-Daten, schreibgeschützte Zukunftsversionen und Reset ohne
  erneute Migration

### 9. Utilities & Hilfsfunktionen

#### `utils.test.mjs`
**Zweck:** Validiert Kern-Hilfsfunktionen.
- **Währungsformatierung:** formatCurrency, formatCurrencyShortLog
- **Math-Funktionen:** Mean, StdDev, Quantile
- **RNG-Stabilität:** Seeding, Forking, Determinismus

#### `formatting.test.mjs`
**Zweck:** Testet alle Formatierungsfunktionen.
- formatCurrency, formatCurrencyShortLog, formatCurrencyRounded
- formatCurrencySafe (undefined → "—")
- formatNumberWithUnit, formatPercentage
- formatPercentValue, formatPercentRatio
- formatDisplayNumber (Tausender-Gruppierung)
- Non-breaking Space Normalisierung

#### `feature-flags.test.mjs`
**Zweck:** Testet Feature-Flag-System.
- **Defaults:** engineMode='adapter', useWorkers=false
- **isEnabled/toggleFlag:** In-memory und localStorage-Persistenz
- **Invalid Flag:** Wirft Fehler

### 10. Integration & Parity

#### `suite-data-integration-contract.test.mjs`
**Zweck:** Bindet den Abschluss der Suite-Datenintegritaet an ein
maschinenlesbares Traceability-Inventar.
- ordnet O-01 bis O-22 konkreten Dateien und Witness-Markern zu;
- bindet alle 65 Ausgangsbefunde des Arbeitsplans an Fix-/Nachweisslices,
  Orakel beziehungsweise direkte Witnesses und das tatsaechliche Node- oder
  Browsergate;
- bildet die acht verbindlichen Zielvertraege I-01 bis I-08
  maschinenpruefbar auf ihre Orakel und direkten Recovery-Witnesses ab;
- prueft die Browservertraege Preview/Commit, 3-Bucket, Hybridprofil,
  Import/Recovery, Sweep und Optimizer;
- inventarisiert Single-/Multi-Profil-, Main-/Worker-,
  MC-/Ein-Zellen-Sweep- und Evaluate-/Apply-Paritaet;
- vergleicht alle sichtbaren Sweep-/Optimizerparameter mit kanonischen Keys,
  Domains, Consumern und Provenienz-Witnesses; dieser Datenpfadnachweis ist
  kein eigenstaendiger KPI-Wirkungsnachweis;
- haelt die freigegebenen Backtest-, Monte-Carlo-, FlowDelta- und
  `engine.js`-Blob-Baselines unveraendert.

#### `portfolio.test.mjs`
**Zweck:** Unit-Tests für Portfolio-Operationen.
- buyGold, sumDepot
- DOM-unabhängige Initialisierung
- Portfolio-Struktur-Validierung

#### `worker-parity.test.mjs`
**Zweck:** Kritische Parity-Prüfung.
- MC/Sweep Chunk-Merges produzieren identische Aggregate wie Single-Pass
- Worker-Chunking beeinflusst Ergebnisse nicht
- Sweep-Metrikmetadaten, Unsicherheitsdiagnostik und CRN-Provenienz bleiben
  ueber Chunkgrenzen identisch.
- Pflegekosten-Drift bleibt beim Szenario-Klon und über Care-Chunks als
  normalisiertes Verhältnis unverändert

#### `depot-tranches.test.mjs`
**Zweck:** Testet Tranchen-Verwaltung.
- **sortTranchesFIFO:** Älteste Tranche zuerst
- **calculateTrancheTax:** Teilverkauf mit TFS und Kirchensteuer
- **applySaleToPortfolio:**
  - FIFO-Reduktion über Matching-Tranchen
  - Proportionale Kostenbasis-Reduktion
  - Mehrere Kategorien (Aktien, Gold, Geldmarkt)
  - Profilbezogene Tranche-IDs verhindern Cost-Basis-Vermischung bei identischen Positionen aus verschiedenen Profilen

#### `tranche-reconciliation.test.mjs`
**Zweck:** Testet Realverkauf und append-only Cashnachweis als heterogenen
`schemaVersion: 1`-Auditvertrag.
- schreibfreie Teil-/Vollverkaufsvorschau, exakte Lot-/Profilidentitaet,
  Ueberverkaufs- und Stale-Gates sowie atomarer Flush/Rollback;
- Default `pending_manual_posting` und explizite Initialbestaetigung
  `confirmed_already_reflected` ohne automatische Cashbuchung;
- kanonische 128-/149-/154-Zeichen-IDs, reservierte Prefixe, globale
  Eindeutigkeit und Konflikt-/Duplicate-Semantik;
- append-only `cash_posting_confirmed` sowie lineare
  `cash_posting_corrected`-Revisionen fuer beide Startformen;
- adversariale Fail-closed-Matrix fuer fehlende Bestaetigung, Luecke, Fork,
  veralteten Rueckverweis, Ziel-/Nettoerloesabweichung, leeren Grund und
  nichtkanonische ID sowie eine fremde Legacy-Recordversion;
- fachliche Duplicate-Semantik bei neu erzeugten Submit-Zeitstempeln unter
  Erhalt des zuerst gespeicherten Nachweiszeitpunkts;
- Legacy-v1-Projektion als `legacy_unknown` ohne Rewrite und ohne falschen
  Pending- beziehungsweise Cash-bestaetigt-Status.

#### `tranchen-manager-page.test.mjs` (Cashstatus-Ergaenzung)
**Zweck:** Testet die Seitenorchestrierung des manuellen Cashstatus-Workflows.
- Zwei-Dialog-Zeuge: Eine parallel belegte Korrekturrevision blockiert vor dem
  finalen `confirm()` und schreibt weder eine neue Revision noch einen alten
  Cashstand;
- unlesbarer Audit wird als unvollstaendige, blockierte Liste statt als leere
  Verkaufshistorie gerendert;
- echter Bestaetigungs-Submit bis zum Facade-Flush haengt genau ein Event an und
  laesst den Verkaufsrecord unveraendert.

### 11. Worker-Pool & Parallelisierung

#### `worker-pool.test.mjs`
**Zweck:** Testet Worker-Pool-Lifecycle und Job-Verwaltung.
- **Pool-Erstellung:** Korrekte Größe, Initialisierung
- **Fehlerbehandlung:** Pool ohne URL wirft Fehler
- **runJob:** Einzelner Job, mehrere parallele Jobs
- **broadcast:** Init an alle Worker
- **Queue-Verarbeitung:** Jobs werden in Reihenfolge abgearbeitet
- **dispose:** Vollständige Ressourcen-Freigabe
- **Transferables:** ArrayBuffer-Übertragung
- **Callbacks:** onProgress, onError
- **Telemetrie:** Job-Start/Complete-Aufzeichnung
- **Worker-IDs:** Eindeutige Zuweisung
- **Größen-Normalisierung:** 0/-5/'invalid' → 1
- **Job-Typen:** 'job' (MC), 'sweep'
- **Idle-Management:** Worker werden nach Job-Ende wieder verfügbar

---

## Test-Kategorien nach Priorität

### Priorität 1: Finanz-Kern (Kritisch)
- `spending-planner.test.mjs`
- `transaction-tax.test.mjs`
- `tax-settlement.test.mjs`
- `core-tax-settlement.test.mjs`
- `liquidity-guardrail.test.mjs`
- `core-engine.test.mjs`
- `engine-robustness.test.mjs`

### Priorität 2: Algorithmen & Logik
- `monte-carlo-sampling.test.mjs`
- `monte-carlo-startyear.test.mjs`
- `simulator-monte-carlo.test.mjs`
- `care-meta.test.mjs`
- `market-analyzer.test.mjs`
- `scenario-analyzer.test.mjs`

### Priorität 3: Transaktions-Details
- `transaction-engine-ath.test.mjs`
- `transaction-engine-rebal.test.mjs`
- `transaction-gold-liquidity.test.mjs`
- `transaction-quantization.test.mjs`
- `spending-quantization.test.mjs`

### Priorität 4: UI & Persistenz
- `balance-*.test.mjs` (alle Balance-App-Tests)
- `profile-storage.test.mjs`
- `profilverbund-*.test.mjs`

### Priorität 5: Integration & Parity
- `worker-parity.test.mjs`
- `scenarios.test.mjs`
- `simulation.test.mjs`
- `simulator-headless.test.mjs`
- `simulator-backtest.test.mjs`
- `simulator-tax-settlement.test.mjs`

### Priorität 6: Utilities & Sweep
- `utils.test.mjs`
- `formatting.test.mjs`
- `feature-flags.test.mjs`
- `simulator-sweep.test.mjs`
- `auto-optimizer.test.mjs`
- `auto-optimize-fidelity.test.mjs`

---

## Debugging

### Testfehler analysieren
Bei fehlgeschlagenen Tests wird detailliertes Logging nach stdout ausgegeben. Einzelne Tests können isoliert werden:
```bash
node tests/run-single.mjs my-test.test.mjs
```

### DOM/Browser-Mocking
Die meisten Tests benötigen Mocks für Browser-Globals. Typisches Pattern:
```javascript
// Setup
const prevLocalStorage = global.localStorage;
global.localStorage = createLocalStorageMock();
global.document = createDocumentMock();

try {
    // ... Tests ...
} finally {
    // Cleanup
    if (prevLocalStorage === undefined) delete global.localStorage;
    else global.localStorage = prevLocalStorage;
}
```

### Worker-Tests
Worker-Tests verwenden MockWorker-Klassen, da echte Web Worker in Node.js nicht verfügbar sind.

---

## Testdatei-Übersicht (Alphabetisch)

| Datei | Lines | Zweck |
|-------|-------|-------|
| `3bucket-config.test.mjs` | ~90 | 3-Bucket-Konfiguration und Engine-Input-Mapping |
| `3bucket-refill.test.mjs` | ~160 | Bond-Refill und 3-Bucket-Nachsteuerung |
| `architecture-evidence.test.mjs` | ~170 | Offline-Contract für Evidenzrecords, Pflichtfelder, IDs, Anker, lokale Links und Fälligkeiten |
| `auto-optimizer.test.mjs` | ~850 | Mehrphasige Optimierung, LHS, Constraints |
| `auto-optimize-fidelity.test.mjs` | ~580 | O-15/O-20, Registry-, Fingerprint- und Apply-Paritaet |
| `auto-optimize-metrics-contract.test.mjs` | ~170 | O-21, P10/P25/P50, D-14, Quantilselector und fail-closed Metriken |
| `auto-optimize-worker-contract.test.mjs` | ~260 | Auto-Optimize Worker-Merge-Contract |
| `balance-annual-cape.test.mjs` | ~140 | CAPE-Abruf, Fallback und Jahresupdate-Contract |
| `balance-annual-inflation.test.mjs` | ~130 | Jährliche Inflationsanpassung |
| `balance-annual-workflow-contract.test.mjs` | ~180 | Jahresupdate-/Jahresabschluss-Workflow-Contracts |
| `balance-binder-snapshots.test.mjs` | ~160 | Snapshot-Erstellung/-Restore |
| `balance-decumulation.test.mjs` | ~120 | Entnahmemodus-/3-Bucket-Input der Balance-App |
| `balance-health-bucket.test.mjs` | ~110 | Pflegebucket-Diagnose und diagnostic-only Policy in Balance |
| `balance-diagnosis-chips.test.mjs` | ~70 | Diagnose-Chip-Rendering |
| `balance-diagnosis-copy-contract.test.mjs` | ~100 | Kopierbarer Diagnose-Exporttext |
| `balance-diagnosis-decision-tree.test.mjs` | ~100 | Entscheidungsbaum-Logik |
| `balance-diagnosis-format.test.mjs` | ~40 | Diagnose-Normalisierung und Grenzfalltexte |
| `balance-diagnosis-guardrails.test.mjs` | ~100 | Guardrail-Chips |
| `balance-diagnosis-keyparams.test.mjs` | ~90 | Key-Parameter- und VPW-Diagnosefelder |
| `balance-diagnosis-transaction.test.mjs` | ~100 | Transaktions-Diagnose |
| `balance-dynamic-flex-gate.test.mjs` | ~100 | Dynamic-Flex-Gating in Balance |
| `balance-expenses.test.mjs` | ~180 | Ausgaben-Check, CSV, Storage und Kennzahlen |
| `balance-reader.test.mjs` | ~640 | DOM-Input-Lesen, Overrides |
| `balance-renderer-action.test.mjs` | ~120 | Action-Rendering, Quellen/Verwendungen |
| `balance-renderer-summary.test.mjs` | ~50 | Summary-Rendering |
| `balance-smoke.test.mjs` | ~340 | End-to-End Smoke-Test |
| `balance-storage-contract.test.mjs` | ~180 | Echte StorageManager-Migrationen und Snapshot-Contracts |
| `balance-storage.test.mjs` | ~490 | localStorage-Persistenz |
| `balance-ui-orchestration.test.mjs` | ~225 | Balance-UI-Bindings, Import-/Export-Control-Pfade, Schema-V1/V2-Migration, CSV-Provenienz und Profilverbund-Hooks |
| `browser-smoke.test.mjs` | ~2670 | Playwright-Gate fuer HTML-Einstiege, MC-/Backtest-UI, A11y/Negativpfade sowie zentrale Balance-/Tranchenflows einschliesslich Reconcile-Pending, Seitenwechsel, Cashabschluss, append-only Korrektur, Retry und Legacy-Anzeige |
| `mc-result-cockpit.test.mjs` | ~100 | Fokussierter DOM-Contract fuer Setup-/Laufkopf-Lifecycle, idempotente Listener, vier ARIA-Ergebnisansichten, zentrale Zielaktivierung, Replay-Schrittstatus und delegierte Vergleichstabs |
| `suite-data-integration-contract.test.mjs` | ~330 | 65 Findings, I-01 bis I-08, O-01 bis O-22, Browser-/Paritaetsinventar, fail-closed Parameterpfade, Gate-Zuordnung und unveraenderte Delta-Baselines |
| `simulator-monte-carlo-browser.mjs` | ~520 | Vier isolierte MC-Browserfaelle fuer Worker, Fallback, Technikfehler, Cancel/Restart, V2-Download, adversarialen Szenariowechsel, A11y, sichtbare Pflege-/4,5-Prozent-Titel sowie centgenaue Exaktwert-/Drawdown-Layouts und die vollstaendige reale Simulatorseite nach einem Lauf bei 320 px |
| `care-meta.test.mjs` | ~200 | Pflegefall-Logik |
| `health-bucket.test.mjs` | ~160 | Pflegebucket-Trigger, Deckung, Verzinsung und Diagnose |
| `core-engine.test.mjs` | ~150 | EngineAPI-Basisvalidierung |
| `core-negative-contracts.test.mjs` | ~130 | Negative Kern-Contracts fuer Stop-Regel-nahe Fehlerpfade |
| `core-tax-settlement.test.mjs` | ~85 | Core Settlement-Integration und globale Quellen-Reconciliation |
| `coverage-inventory.test.mjs` | ~120 | Coverage-Inventar, Modulklassifikation und ungeladene/runtime-geladene Dateien |
| `coverage-report.test.mjs` | ~220 | V8-Coverage-Report, Pfadnormalisierung, Leerreport und obligatorische Dateigates |
| `results-renderers.test.mjs` | ~620 | DOM-freie Ergebnisrenderer fuer Outcome, KPIs, Unsicherheit, Pflege, Sampling, Missingness und Fehlerpfade |
| `depot-tranches.test.mjs` | ~130 | FIFO-Verkäufe, Steuer |
| `dynamic-flex-horizon.test.mjs` | ~40 | Sterbetafel-Horizonte, Single/Joint, Mean/Quantil |
| `engine-robustness.test.mjs` | ~240 | Edge Cases, Fehlereingaben |
| `feature-flags.test.mjs` | ~60 | Feature-Flag-System |
| `formatting.test.mjs` | ~120 | Formatierungsfunktionen |
| `historical-backtest-runner.test.mjs` | ~550 | DOM-freier Backtest-Runner, Dependency Injection, V1-Outcome/Result, Reconciliation und Non-Mutation |
| `historical-backtest-contract.test.mjs` | ~340 | V1-YearRecord, Missingness, Perioden-/Batch-Preflight, Cache-Instrumentation und Builderinventar |
| `historical-backtest-metrics.test.mjs` | ~170 | Versioniertes Metrikwoerterbuch, Reconciliation, Missingness und Outcome-Regeln |
| `historical-backtest-cohorts.test.mjs` | ~210 | Feste Rolling-Cohort-Fenster, Batch-Preflight, Outcome-/Ausschlussinventar und Aussagegrenze |
| `historical-backtest-export.test.mjs` | ~310 | Raw-JSON/CSV, Fingerprints, Provenienz, Roundtrip, HTML-/Formelinjektionsschutz |
| `historical-data-manifest.test.mjs` | ~180 | Manifestvollstaendigkeit, unresolved-Gates, kanonischer SHA-256 und immutable Lookup |
| `global-equity-research-chain.test.mjs` | ~100 | Gepinnte offene Eingaben, 1925-2025-Verkettung, Laenderluecken, Evidenzsegmente und neutrale Identitaet |
| `german-cash-money-market-chain.test.mjs` | ~360 | Gepinnte JST-/Bundesbank-Eingaben, 1925-2025-Kette, Methodenbrueche, Waehrungsreformgrenze, Cash-/Bond-Anwendung, Disclaimer und Hashbruecken |
| `german-cash-money-market-source-reconstruction.test.mjs` | ~230 | Unabhaengige PDF-Koordinatenrekonstruktion aller 77 Bundesbank-Jahre plus JST, einzig erlaubte Schaetzluecke und read-only Generatorgate |
| `german-cash-money-market-backtest-delta.test.mjs` | ~340 | Slice-04-Vorher-/Nachher-Beleg, Markerjahre, Steuer-/Kostenabgrenzung und FlowDelta |
| `german-gross-wage-growth-chain.test.mjs` | ~370 | JST-/Destatis-Quellidentitaet, Gebiet, Praezision, Methodenbrueche, Runtimeprojektion, Hash- und Generatorgate |
| `german-gross-wage-independent-oracle.test.mjs` | ~180 | Unabhaengiger XLSX-Parser fuer 22 JST-Lohnveraenderungen und zustandsbasierter HTML-Parser fuer alle 79 amtlichen Jahre |
| `gold-german-investor-chain.test.mjs` | ~460 | Gepinnte JST-/Bundesbank-/World-Bank-Eingaben, 1925-2025-Goldkette, Naehte, Nullwerterklaerungen, Runtimeprojektion und read-only Generatorgate |
| `gold-german-investor-backtest-delta.test.mjs` | ~240 | Slice-05-Invarianz goldfreier Faelle und deterministischer goldhaltiger Delta-Witness |
| `gold-german-investor-independent-oracle.test.mjs` | ~230 | Zweiter quellnaher XLSX-/CSV-Parser und unabhaengige Vollrekonstruktion aller 101 Goldreturns |
| `poppler-toolchain.test.mjs` | ~15 | Portierbare Aufloesung, Mindestversionsvertrag und Ablehnung inkompatibler Poppler-Versionen |
| `historical-data-robustness.test.mjs` | ~60 | Fehlende Marktdaten |
| `simulation-data-inventory.test.mjs` | ~330 | Historien-/Statik-Inventar, Evidenzklassen, Wertfingerprints und fail-closed Quell-/Lizenz-Gates |
| `us-shiller-cape-chain.test.mjs` | ~930 | Gepinntes Shiller-XLS, 101 Dezember-t-1-Entscheidungssignale, Headeridentitaet, Qualitaetssegment, No-Double-Lag und Generatorgate |
| `us-shiller-cape-independent-oracle.test.mjs` | ~220 | Zweiter OLE-/BIFF-Parser und unabhaengige Vollrekonstruktion aller 101 Shiller-CAPE-Entscheidungssignale aus der gepinnten Monatsquelle |
| `cape-utils.test.mjs` | ~20 | Explizite Entscheidungssignal-Eingabe, genaue Kandidatendeltas und vollstaendiger Estimated-History-Ausschluss des CAPE-Schaetzsegments |
| `liquidity-guardrail.test.mjs` | ~100 | Liquiditäts-Guardrails |
| `liquidity-runway-contract.test.mjs` | ~480 | Reiner Slice-08-Runwayvertrag: Default, Domain, Schritt, Fehlerwerte, Legacy-Migration und abgeleitete Policy |
| `market-analyzer.test.mjs` | ~150 | Markt-Regime-Klassifizierung |
| `mc-worker-contract.test.mjs` | ~170 | MC-Worker-Entrypoint, Lifecycle und Fehlervertraege |
| `monte-carlo-export-contract.test.mjs` | ~900 | V1-/V2-Request-, Result- und Exportprovenienz, Heatmap-/Einheitenvertrag, Drawdown-Domaene, ScenarioLog-V2-JSON/CSV, Akkumulations-Missingness, Mindest-Flex-Quelltrennung, Legacy-Warnungen und fail-closed Dispatcher |
| `stress-replay-e2e.test.mjs` | ~360 | Echter 60-Jahres-Durchstich ueber V2-Floor/Flex/Mindest-Flex bis Engine-Diagnostik, Nullwert-Export/Import, erneut ausgefuehrter V1-Roundtrip, Groessenlimit und getrenntes Performancebudget |
| `stress-replay-contract.test.mjs` | ~380 | Fail-closed V1-/V2-Schemas, Bedarfsrelation, Variantenbereiche 0–50/0–70, Terminalzeilen und unabhaengige Herkunftsidentitaet |
| `stress-replay-persistence.test.mjs` | ~370 | Transaktionales Speichern/Verwerfen, Readback, Rollbackfehler, Reload-/Import-Identitaet und Nur-Lesen-Kompatibilitaet |
| `stress-replay-transactions.test.mjs` | ~500 | Ausschliesslich belegte Transaktionsklassen, Capture-Paritaet sowie explizite Event-/Breakdown-Missingness und Summenabgleich |
| `stress-replay-ui.test.mjs` | ~740 | Controllerweiter Busy-/Reentrancy-Vertrag, Deferred-Promise-Rennen, Reload/Import sowie sichtbare Replay-Aktivierung vor asynchronen Fokuszielen |
| `stress-replay-renderer.test.mjs` | ~400 | Terminalzeilen, Missingness, priorisierte nicht empfehlende Kernaussagen, Vergleichs-Unteransichten und eindeutige Jahres-/Prozentpunkt-Deltatexte |
| `monte-carlo-measurement-contract.test.mjs` | ~1100 | Golden Cases, Snapshot-Linie, Delta-Ledger, Ressourcen-/Worker-Paritaet |
| `monte-carlo-sampling.test.mjs` | ~200 | Bootstrap, Regime-Transitions |
| `monte-carlo-startyear.test.mjs` | ~100 | Startjahr-Auswahl |
| `persistence.test.mjs` | ~900 | PersistenceFacade, IndexedDB/localStorage/Tauri-Adapter und Migrationen |
| `portfolio.test.mjs` | ~100 | Portfolio-Operationen |
| `project-license-metadata.test.mjs` | ~80 | MIT-Projektlizenz in Lizenztext, npm-/Cargo-Metadaten und normativer Dokumentation |
| `profile-asset-values.test.mjs` | ~80 | Profil-Assetwerte und Aggregation |
| `profile-navigation.test.mjs` | ~100 | Profilnavigation und UI-State |
| `profile-state.test.mjs` | ~100 | Profilzustand und Storage-Contracts |
| `profile-storage.test.mjs` | ~570 | Profil-Registry CRUD, Bundle-Tranchen |
| `profile-ui-contract.test.mjs` | ~160 | Profil-UI-Contracts, Navigation und DOM-nahe Profilaktionen |
| `profilverbund-balance.test.mjs` | ~230 | Multi-Profil Aggregation, Entnahmeverteilung, Asset-Summaries |
| `profilverbund-profile-gold-overrides.test.mjs` | ~160 | Gold-Parameter-Overrides |
| `runner-contract.test.mjs` | ~260 | Test-Runner-Sortierung, Null-Assertion-Gate, Isolation, separate Gates, Legacy-Zaehler und QUICK_TESTS-Deprecation |
| `scenario-analyzer.test.mjs` | ~95 | Szenario-Tags, Vergleich |
| `slice-02-risk-display-copy-contract.test.mjs` | ~75 | Sichtbarer Copy-Contract fuer P10-Auswahlkriterium, Pflege-Nichtkausalitaet sowie Basis, Operator und Berichtsrolle der 4,5-Prozent-Anzeige in Ergebnissen, Heatmap und Auto-Optimize |
| `scenarios.test.mjs` | ~150 | Komplexe Lebenspfade |
| `simulation.test.mjs` | ~200 | Simulations-Integration |
| `simulator-3bucket-ui-e2e.test.mjs` | ~130 | 3-Bucket-UI-Integration im Simulator |
| `simulator-backtest-characterization.test.mjs` | ~990 | Legacy-/Target-Golden-Cases, Negativfaelle, Messvertrag und Delta-Reporter fuer den historischen Backtest |
| `simulator-backtest-ui.test.mjs` | ~200 | Backtest-Periodenvalidierung, Statussicherheit, Datenqualitaet, Tabellen-A11y und Cohort-Nullnenner |
| `simulator-backtest.test.mjs` | ~150 | Historischer Backtest |
| `simulator-dynamic-flex-persistence.test.mjs` | ~110 | Persistenz von Dynamic-Flex-Inputs |
| `simulator-headless.test.mjs` | ~125 | Headless 2000-2025 |
| `simulator-household-needs-persistence.test.mjs` | ~180 | Migration, Schema, Validierung und Präzedenz globaler Haushaltsbedarfs-Overrides |
| `simulator-heatmap.test.mjs` | ~60 | Heatmap-Rendering |
| `simulator-input-readers.test.mjs` | ~160 | DOM-freie Simulator-Input-Reader |
| `simulator-log-columns.test.mjs` | ~110 | Logspalten für Entnahme, VPW, Bonds und Steuer |
| `simulator-monte-carlo.test.mjs` | ~1300 | MC-Kern, Buffers, Merge sowie typisierte finanziell auswertbare und terminale Logrecords |
| `simulator-real-withdrawal-contract.test.mjs` | ~415 | Realentnahme, kumulierter Inflationsfaktor, Anspar-Transition sowie punktgleicher nominaler/realer MC-Drawdown |
| `simulator-multiprofile-aggregation.test.mjs` | ~190 | Simulator Multi-Profil, Tranchen-Merge |
| `simulator-sweep.test.mjs` | ~470 | Parameter-Sweep |
| `simulator-tax-settlement.test.mjs` | ~180 | Simulator Settlement-Recompute |
| `simulator-ui-orchestration.test.mjs` | ~230 | Simulator-UI-Bindings, Tabs, Persistenz und Optimizer-Parameteruebernahme |
| `snapshot-archive.test.mjs` | ~160 | Kanonisches Snapshot-Archiv, Indexeintraege und Restore-Contracts |
| `snapshot-key-policy.test.mjs` | ~130 | Snapshot-Key-Policy, Restore-Grenzen und technische Key-Ausnahmen |
| `spending-planner.test.mjs` | ~200 | Entnahme-Logik |
| `spending-quantization.test.mjs` | ~80 | Entnahme-Rundung |
| `suite-data-three-bucket-final-action.test.mjs` | ~430 | Slice-02-Final-Action, profilbezogene Lot-Reservierung, Nullbudgets, Lot-/Gold-Kapazitaet sowie kapazitaetsbegrenzte Steuer- und Profil-Reconciliation |
| `tauri-csp.test.mjs` | ~130 | Tauri-CSP, Live-Daten-Endpunkte und Icons |
| `transaction-engine-ath.test.mjs` | ~160 | ATH-Verhalten |
| `transaction-engine-rebal.test.mjs` | ~105 | Gold-Rebalancing |
| `transaction-gold-liquidity.test.mjs` | ~90 | Gold vs. Liquidität |
| `transaction-quantization.test.mjs` | ~250 | Transaktions-Rundung |
| `tax-settlement.test.mjs` | ~70 | Jahres-Settlement, Verlusttopf |
| `tranchen-manager-modal.test.mjs` | ~120 | Tranchenmanager-Modal und Form-Parsing |
| `tranchen-manager-page.test.mjs` | ~850 | Tranchenmanager-Seitenentrypoint, App-Bindings, Persistenz-/Profilgates sowie Cashstatus-Stale-, Fehler- und Submit-Contract |
| `tranchen-manager-renderer.test.mjs` | ~100 | Tranchenmanager-Rendering |
| `tranchen-manager-state.test.mjs` | ~120 | Tranchenmanager-State und Derived Values |
| `tranchen-price-service.test.mjs` | ~160 | Preisservice-Proxy, Symbolauflösung, Timeout und degradierter Status |
| `tranche-reconciliation.test.mjs` | ~750 | Realverkauf, heterogener v1-Audit, Cashstatus, kanonische IDs, lineare Korrekturkette, Legacy-Schemaversion, semantische Idempotenz und Persistenz-Rollback |
| `transaction-tax.test.mjs` | ~340 | Steuerberechnung, Roh-Aggregate |
| `utils.test.mjs` | ~100 | Hilfsfunktionen |
| `vpw-dynamic-flex.test.mjs` | ~230 | VPW-Formel, Smoothing, Safety und Go-Go |
| `worker-parity.test.mjs` | ~800 | Worker-Chunk-Parity einschliesslich absolut indexierter Stress-Replay-Capture-Identitaet ueber Chunkgrenzen |

### Stress-Replay-Performancebaseline

`fixtures/stress-replay-performance-baseline-v1.json` ist eine versionierte,
synthetische Messfixture ohne personenbezogene Finanzdaten. Gemessen wird ein
vollstaendiger Vergleich aus Baseline plus einer Alternative auf einem
materialisierten 60-Jahres-Pfad. Referenz: WSL2 Linux, Node.js v22.23.2, AMD
Ryzen 7 3700X; zwei Warmups und fuenf Messungen ergaben am 2026-08-15 einen
Median von 435,858 ms bei 88.524 Byte JSON-Export. Das Testbudget ist der
groessere Wert aus vierfacher Baseline und 250 ms. Damit faengt es deutliche
Regressionen ab, ohne Scheduler-/Energiesparrauschen als Fachfehler zu werten.
Die veraltete, nicht gemessene Forderung `p95 < 50 ms fuer 240 Jahreslaeufe`
wird nicht verwendet.

`fixtures/stress-replay-comparison-export-v1.json` ist das Golden-Orakel fuer
einen historischen Export mit ausschliesslich V1-Whitelistvarianten. Der
E2E-Test erzeugt zusaetzlich aus einem echten materialisierten Pfad einen
V1-Export, importiert ihn und fuehrt ihn mit Baselineuebernahme fuer die
fehlenden V2-Bedarfsblaetter erneut aus.
| `worker-pool.test.mjs` | ~670 | Worker-Pool-Lifecycle |

### Auswertung: Bedien- und Prüfvertrag

Balance hat drei Reiter: Überblick, Bedarf & Strategie und Diagnose. Die vollständige Verlaufskarte liegt in Personen & Vermögen; alte Balance-Verlaufsanker werden geschützt weitergeleitet. Das bestehende Datenformat und die Jahres-/Import-Nacherfassung bleiben unverändert.

- `tranchen-history-closures.test.mjs`: Frozen Quellen, gespeicherte ◆/◇-Marken am tatsächlichen Datum/Wert, Achsenumfang bis heute, Marken ohne Tageslinie, Kennzahlen-/Tabellenparität und Profilwechsel ohne Datenwrite.
- `tranchen-history-wealth-capture.test.mjs`: produktiver Managerknopf mit realem Vorschau-/Schreibdienst, exakt sieben Tage/älter/unbekannt/kursfrei, Tagesersetzung, Ergänzung, Jahreskoexistenz, Live-/Registryreadback, Rollback und Reload.
- `wealth-history-legacy-navigation.test.mjs`: initiale Altanker, späterer Hashwechsel, Profilübergabe, Flushfehler und Ablehnung ohne Seitenwechsel. `balance-smoke.test.mjs` belegt den echten Main-Start vor jeder Engineberechnung; `tranchen-manager-profiles.test.mjs` die Ankunft mit erhaltenem aktivem Profil und tatsächlicher DOM-Bindung.
- Bestehende Historien-, Jahres-, Ausgaben- und Profiltests sichern den unveränderten Datenpfad. `balance-wealth-history-chart.test.mjs` bewahrt Aufbereitung und Formatierung sowie die neue Drei-Reiter-Grenze.

Das normale `npm test` führt der Orchestrator auf dem endgültigen Stand aus. Sandbox-Startverbote bei Kindprozessen werden mit Pfaden berichtet und außerhalb erneut geprüft. Das Windows-Backtestgate samt Baselines bleibt unverändert. Im Browser-Smoke entfallen ausschließlich Prüfungen der abgelösten Balance-Verlaufhosts und ihres Captureknopfs; bestehende übrige Abläufe bleiben erhalten. Neue Browserfälle, Fokus-Härtungen oder Druckregeln werden nicht eingeführt. Browserausführung und manuelle Abnahme bei 1920×1080/2560×1440 bleiben der gesteuerten Sitzung vor dem Merge vorbehalten.

## Darstellung der Navigationsnachfrage – Paket 2b, Nachtrag 3

Die injizierbaren Quellverträge in `designsystem-source-contract.mjs` binden
`margin: auto`, `padding: var(--space-6)`, opake Dialogfläche/Textrolle und
`background: var(--backdrop)` an die konkreten Navigationsselektoren. Die spätere
Druckregel verdrängt dabei nicht die Basisprüfung. Der Grafiktoken muss genau einmal
kanonisch in `:root` stehen: `color-mix(in srgb, var(--text-main) 45%, transparent)`.
Das Ausnahmemanifest benennt ausschließlich den textfreien Backdrop als neue
grafische Ausnahme; opake Textkontrastlisten nehmen ihn nicht auf.

`designsystem-components.test.mjs` und `designsystem-foundation.test.mjs` prüfen
Originalquellen und wirksame Quellkopien mit entfernten/falschen Margin-, Padding-,
Backdrop- und Tokendeklarationen einschließlich falscher Rolle/Anteil, Doppeldefinition,
Kommentarattrappe und nichtkanonischer Definition. Transparenter Text über den
Grafiktoken sowie reduzierte Dialog-/Textelterndeckkraft scheitern weiterhin gezielt.
`designsystem-layout.test.mjs` bindet diese Diagnosen an den vollständigen
Präsentationsvertrag. Die Quellen der Produktdateien werden für Gegenproben nicht verändert.

Der separat registrierte Browserfall `Navigation guard presentation` umfasst
22 Öffnungen bei **1366 × 900** und **1920 × 900**:

- Zehn Seitenwechsel über echte Rahmenlinks auf Startseite, Balance, Simulator,
  Manager und Handbuch; die Startseiteneingabe `#profileNameInput` bleibt befüllt.
- Zwei Verwerfnachfragen im Manager über `#depotAddTrancheBtn`, eine echte Dirty-Eingabe
  in `#name` und `#closeTrancheModalBtn`, ohne Ersatzprovider. Der Fachdialog bleibt
  darunter geöffnet und Bleiben erhält die Eingabe.
- Zehn Schlussvarianten auf denselben fünf Seiten über den echten gemeinsamen
  Guard mit `prepare({ intent: 'close' })`, vorhandenem Titel/Schlussknopf und
  anschließendem Bleiben; die Entscheidung wird vollständig abgewartet.

Vor jeder Messung: sichtbarer Dialog, `:modal`, `document.fonts.ready` und zwei
Animationsframes. Mittelpunktabweichungen dürfen je Achse höchstens 2 CSS-Pixel
betragen, alle vier Paddings müssen endlich und mindestens 24 CSS-Pixel sein.
Eine transparente 1×1-Canvas misst den Backdropalpha aus der gültigen berechneten
Farbe (vorher `CSS.supports`); zulässig ist 0,3 bis 0,6. Kontext-/Zeichen-/Lesefehler
und ungültige Farben scheitern. Dialogfläche, Textfarben und Dialog-/Textelterndeckkraft
werden zusätzlich auf volle Deckkraft geprüft. Diagnosen enthalten Seite, Breite,
Variante und Messwerte. Alle `page.waitForFunction`-Prädikate bleiben synchron;
vor dem nächsten Öffnen werden Dialogende und Guard-Idle gemeinsam abgewartet.

Gezielte Node-Prüfungen:

```sh
node --check tests/browser-smoke.test.mjs
node tests/run-single.mjs tests/designsystem-components.test.mjs
node tests/run-single.mjs tests/designsystem-foundation.test.mjs
node tests/run-single.mjs tests/designsystem-layout.test.mjs
node tests/run-single.mjs tests/navigation-guard-dialog.test.mjs
node tests/run-single.mjs tests/suite-frame.test.mjs
node tests/run-single.mjs tests/balance-annual-navigation.test.mjs
```

Die volle Node-Suite führt der Orchestrator aus. Browserläufe und Bildabnahme sind
gesonderte Nachweise der Steuerung außerhalb der Sandbox; ein Syntaxcheck ist
kein Browsernachweis. Selektive Browserbefehle:

```sh
node tests/browser-smoke.test.mjs --only='Navigation guard presentation'
node tests/browser-smoke.test.mjs --only='Navigation guard links'
node tests/browser-smoke.test.mjs --only='Navigation guard modal'
node tests/browser-smoke.test.mjs --only='Navigation guard annual'
```

Die Steuerung nimmt zusätzlich Dialogbilder aller fünf Seiten bei beiden Breiten
auf, einschließlich Manager mit offener Tranche und Eingabe, und bestätigt
Zentrierung, Innenabstand und sichtbar gedimmten Hintergrund. Diese Bilder und die
Schlussdarstellung im Browser ersetzen keine native EXE-/IPC-Abnahme.

## Designsystem-Grundlage (Slice 1)

`designsystem-foundation.test.mjs` prüft anhand einer injizierbaren Quellmap in
`designsystem-source-contract.mjs` Ladefolge, exakte Farbrollen, Aliasauflösung,
alle acht lokalen Fontfaces, fehlende/externe Quellen, zusätzliche Prioritäten,
Text-/Elterndeckkraft und zulässige Kontrastpaare. Jede statische Regel besitzt
Gegenproben ohne Produktmutation. Alte `!important`-Ausnahmen sind nach Datei,
Selektor und Deklaration gebunden, kein austauschbares Mengenkontingent.
Das Manifest umfasst die fünf Seiten, die beiden Seiten-CSS, Tokens/Fontfaces,
Balance-Startmeldungen und die neue Symbolhilfe. Zielbild/Prototyp sind ausgeschlossen;
noch nicht migrierte Renderer gehören zu späteren Slices.

`designsystem-icons.test.mjs` prüft feste Namensfreigabe, Modul-relative Quellen,
Dokumentzuordnung über einen DOM-Grenzadapter, Schmuckattribute, Ladefehler und
SVG-Abweisung. Den echten DOMParser und importNode prüft der registrierte Browserfall.
`tauri-csp.test.mjs` bindet sämtliche CSP-Direktiven exakt und erlaubt lokale WOFF2-Dateien;
nur die beiden Google-Fontquellen entfallen.

Gezielte Node-Läufe:

```bash
node tests/run-single.mjs tests/designsystem-foundation.test.mjs
node tests/run-single.mjs tests/designsystem-icons.test.mjs
node tests/run-single.mjs tests/tauri-csp.test.mjs
node tests/run-single.mjs tests/funktionsinventar.test.mjs
```

Der registrierte Fall `Designsystem foundation` lädt auf allen fünf Seiten alle
acht lokalen Fonts bei vollständig blockierten externen Requests. Er misst Grundfarben,
Familien, Karten und Hauptaktionen bei 1366/1920/2560 px, prüft das konkrete SVG im
Dokument und erhält den Linktext bei einem injizierten Symbol-Ladefehler.
Die früheren Google-Leerantworten im Routing wurden entfernt.

```bash
node tests/browser-smoke.test.mjs --only='Designsystem foundation'
```

Die Sandbox erlaubt keinen lokalen Serverstart (`listen EPERM`); der Browserfall
muss durch die gesteuerte Sitzung ausgeführt werden. Die volle Node-Suite führt
im orchestrierten Lauf ausschließlich der Orchestrator aus. Die gezielten
Quellprüfungen ersetzen keine Layout-/EXE-Abnahme.

## Gemeinsame Designsystem-Bausteine (Slice 2)

`designsystem-components.test.mjs` prüft die gemeinsamen Rollen und Ladefolge
auf fünf Seiten, tokenisierten Fokus, benannte Symboltasten und gültige
Feldzustände. Injizierte Gegenproben für namenlose Tasten, ungültige Zustände,
Text-/Elterndeckkraft und nicht tokenisierte Inline-Textfarben müssen scheitern.
`designsystem-field-state.test.mjs` prüft alle sieben Zustände, Wechsel,
idempotente Updates, eindeutige/stabile Gründe, Erhalt fremder Beschreibungs-IDs
sowie unveränderte Werte, Sperren und Inputattribute.
`designsystem-start-handbook.test.mjs` führt den tatsächlichen I10-Inline-Renderer
aus: Quarantänehinweis, Importdateiauslösung, Schließen und erneute Sitzung ohne
Speicher-/Warnstatusmutation. Handbuchanker und Abbildungen bleiben geschützt.
Das Inventar bindet diese konkreten Node- und Browserbelege ein; die
Paket-1-Nachweislücke von I10 ist geschlossen, Paket 2 bleibt offen.

```bash
node tests/run-single.mjs tests/designsystem-components.test.mjs
node tests/run-single.mjs tests/designsystem-field-state.test.mjs
node tests/run-single.mjs tests/designsystem-start-handbook.test.mjs
node tests/run-single.mjs tests/designsystem-foundation.test.mjs
node tests/run-single.mjs tests/funktionsinventar.test.mjs
node tests/funktionsinventar-contract.mjs --check
node tests/funktionsinventar-contract.mjs --self-test
node scripts/generate-funktionsinventar.mjs --check
```

Registrierte Browserfälle `Designsystem components`, `Designsystem recovery banner`
und `Handbuch.html` prüfen echten DOM, Tastaturfokus, Quarantäne mit synthetischem
Tauri-Backend, Dateiauswahl, Schließen/Reload sowie Reiter, TOC-Hash/Fokus und sechs
Abbildungen. Recovery und Handbuch werden bei 1366/1920/2560 px geprüft.

```bash
node tests/browser-smoke.test.mjs --only='Designsystem components'
node tests/browser-smoke.test.mjs --only='Designsystem recovery banner'
node tests/browser-smoke.test.mjs --only='Handbuch.html'
```

Der Server-/Browserstart bleibt in der Sandbox nicht ausführbar (`listen EPERM`).
Diese Fälle fährt die gesteuerte Sitzung; die volle Node-Suite fährt der Orchestrator.
Die Simulator-Legendenbedienung bleibt Paket 4.1, die vollständige Handbuchmigration
Paket 6.3. Die Quellprüfungen ersetzen den Browsernachweis nicht.

## Balance-Designsystem (Slice 3)

- `designsystem-balance.test.mjs`: benannte Quellconsumer, Alias-/Prioritätsvertrag,
  Gegenproben zu Textdeckkraft/Farbe/namenloser Taste; tatsächlicher Profil-Sync
  mit synthetischen Einzel-/Haushaltsfixtures vor/nach reiner Darstellung,
  Start/Aktualisierung, erhaltene Werte/Sperren/Altattribute, versteckte Brücken
  und echte Jahresdialog-Warn-/Fehlerausgabe samt Schließen.
- `balance-expenses.test.mjs`: Leerjahr/-monat, gespeicherter Nullimport,
  ausgeblendete Profilpräsenz, unveränderte Metriken/Datenobjekte,
  Budgetgrenzen 100/105/>105 %, additive Matrixaktionen und alte Hidden-/Tabindexregeln.
- `balance-renderer-summary.test.mjs`: tatsächliche Entnahme-, Markt-, Inflations-,
  Runway-/Vergleichs- und Pflegeausgabe mit erhaltenen Klassen, Gründen und Werten.
- `balance-smoke.test.mjs`: tatsächlicher Balance-Start mit dokumentzugeordneten
  DOM-Knoten, erreichbaren Herkunftsgründen an acht übernommenen Feldern und
  weiterhin unveränderten verborgenen Brücken; die vorhandenen Update-,
  Fehler-, Import- und Persistenzprüfungen bleiben erhalten.
- Registrierter Browserfall `Designsystem Balance`: synthetischer Profilverbund,
  Herkunft bei Start/Aktualisierung, unveränderte DOM-Inputverträge, Null-/Leermonate,
  Import/Details/Delete, Leerjahrwechsel, Jahreswarn-/Fehlerdialog und Druckausblendungen.
  Bestehende Meldungs-/Engine-/Recoveryfälle bleiben registriert; der Rahmen im
  Fall `Balance message presentation` erwartet jetzt das Fehler-Token.

Gezielte Ausführung über `node tests/run-single.mjs tests/<name>.test.mjs`;
neue `*.test.mjs` entdeckt der Node-Runner automatisch. Browser gezielt:
`node tests/browser-smoke.test.mjs --only="Designsystem Balance"`.
Die Sandbox verhindert den Serverstart (`listen EPERM`); dies ist kein erfolgter
Browsernachweis. Volle Node-Suite durch den Orchestrator, Browser-/Druckabnahme
anschließend durch die gesteuerte Sitzung.

## Simulator-Feldzustände und gemeinsame Dynamic-Flex-UI (Slice 4)

`designsystem-simulator-fields.test.mjs` prüft die tatsächliche Darstellung mit
DOM-Eltern und mehreren Listenern: 96 Kombinationen aus Details, Dynamic Flex,
Go-Go, Horizontmethode und Langlebigkeit; außerdem Presets, Bootstrap, Rentenmodus,
Profilanzahl, nachfolgenden Profil-Lock, Partner, Ansparphase, Pflege und 3-Bucket.
Explizite Bestandsbedingungen und synthetische Werte sichern unveränderte Sperren,
Sichtbarkeit, Portfolioaufteilung, Renten-/Steuereinheiten und versteckte S15-Brücken.
Busy- und Recoverychecks verwerfen eine pauschale `disabled`→`inactive`-Ableitung.
Der injizierbare Quellvertrag prüft Feldrollen, Tokenfarben und fehlende Deckkraft
mit scheiternden Gegenproben. Zuordnung: B15–B17, S03–S04, S08–S11, S13–S20, S24.

Gezielte Läufe:

```sh
node tests/run-single.mjs tests/designsystem-simulator-fields.test.mjs
node tests/run-single.mjs tests/simulator-ui-orchestration.test.mjs
node tests/run-single.mjs tests/simulator-dynamic-flex-persistence.test.mjs
node tests/run-single.mjs tests/longevity-ui-persistence.test.mjs
node tests/run-single.mjs tests/simulator-multiprofile-aggregation.test.mjs
node tests/run-single.mjs tests/simulator-input-readers.test.mjs
node tests/run-single.mjs tests/balance-dynamic-flex-gate.test.mjs
```

Registrierter Browserfall `Designsystem simulator fields`: sichtbare Herkunft und
Gründe bei 1366/1920/2560 px, Profilwechsel, unveränderte Preset-/Bootstrapwerte und
Legacy-Unsichtbarkeit. `Simulator household needs reload` prüft Herkunft zusätzlich
nach Start/Reload; `Simulator corrupt profile balance` prüft Recovery ohne fachliche
Nichtanwendbarkeitsklassifikation. Diese Fälle verändern keine Akkordeon-/Reiter-
oder Profil-Handoff-Implementierung.

```sh
node tests/browser-smoke.test.mjs --only='Designsystem simulator fields'
```

Die volle Suite und Browserausführung übernimmt im orchestrierten Lauf die Steuerung.

### Designsystem: Simulator-Ergebnisse (Slice 5)

`node tests/run-single.mjs tests/designsystem-simulator-results.test.mjs` prüft
acht vollständige synthetische Viewmodels gegen SHA-256-Digests des Basiscommits
`a7fcdfc7` (allein Floor-success wird zu default normalisiert), unveränderte
Rohdaten, sichtbare vollständige Beschreibungen, additive Ergebnis-/Replayrollen,
Tokenfarben, Kontrast und Textdeckkraft. Gegenproben verändern Quellen und
wirklich erzeugtes Markup. Fachliche Exaktwerte/Missingness sichern zusätzlich
`results-metrics`, `results-renderers` und `stress-replay-renderer` ab.
`mc-result-cockpit.test.mjs` prüft weiterhin exakt fünf Ergebnisreiter anhand
vollständiger Klassenmitgliedschaft, auch mit der additiven Rolle `ds-tab`.

Der registrierte Browserfall lässt sich außerhalb der Agentensandbox mit
`node tests/browser-smoke.test.mjs --only="Designsystem simulator results"`
ausführen. Er prüft neutrale Floor-Karten bei 0/1 %, kleine Stichproben,
technische Fehler und Leerdaten, vollständige Gründe, centgenaue reale EUR-Werte,
vier Drawdown-Prozente, bestehende Ergebnis-/Replayreiter und Druckpanels.
Ein sandboxbedingtes `listen EPERM` ist kein fachlicher Testbefund.

### Designsystem: Werkzeugrenderer und Grafikfarben (Slice 6)

`designsystem-charts.test.mjs` sichert sechs komplette SVG-/Grafikprojektionen
und alle vier Portfolio-Datenpfade gegen Messungen aus Basis `d6edc965`.
Die erlaubten Änderungen sind Palette/Typografie, additive Klassen und opake
Labelplatten; Zahlen, Bins, Skalen, Koordinaten, Beschreibungen und Warnbedingungen
bleiben gebunden. Stützpunkte, 1001 Interpolationswerte, injizierte Tokenmap,
Dokumentauflösung, DOM-freie CSS-Ausdrücke, Null/fehlend, Warn-/Invalidrand und
kritische Überlagerung sind geprüft. Textkontrast kommt über den gesamten Bereich
aus dem opaken Paar Haupttext/surface, nicht aus einer Helligkeitsschwelle.

`designsystem-tools.test.mjs` prüft vollständige tatsächliche Championtexte gegen
Basisdigests an den vier Stabilitätsgrenzen, unveränderte Rohdaten, echte
Parameter-Keylistener mit Domänengrenzen und den Sweep-Übernahmelistener.
Die injizierbare Quellmap umfasst alle zehn benannten Werkzeugconsumer und die
Farbhilfe. Gegenproben verwerfen Altpalette, Linien-/Serientext, fehlende Aliase,
Prioritäten, Textdeckkraft (auch im generierten HEATMAP_V4_STYLE), falsche
Labelunterlagen und das Aufweichen des opaken Labelpaars.

```sh
node tests/run-single.mjs tests/designsystem-charts.test.mjs
node tests/run-single.mjs tests/designsystem-tools.test.mjs
node tests/run-single.mjs tests/simulator-heatmap.test.mjs
node tests/run-single.mjs tests/simulator-sweep-consumers.test.mjs
node tests/run-single.mjs tests/simulator-sweep.test.mjs
node tests/run-single.mjs tests/auto-optimize-metrics-contract.test.mjs
node tests/run-single.mjs tests/auto-optimizer.test.mjs
node tests/run-single.mjs tests/simulator-backtest-ui.test.mjs
node tests/run-single.mjs tests/balance-wealth-history-chart.test.mjs
node tests/run-single.mjs tests/balance-expenses-history.test.mjs
node tests/browser-smoke.test.mjs --only='Designsystem tools'
```

Der registrierte Browserfall verwendet kurze echte Backtest-/Sweep-/Built-in-
Optimizerläufe und prüft Ausgabe-/Übernahmeanker sowie Tokenfarben bei
1366/1920/2560 px. Die vorhandene readConfig-Injektion verkürzt nur im Test das
feste Optimizerfenster auf zwei Jahre. Die Produktvorgaben bleiben erhalten.
Der Browserstart ist hier durch `listen EPERM` gesperrt; die gesteuerte Sitzung
führt ihn vor dem Merge aus. Die volle Node-Suite bleibt dem Orchestrator vorbehalten.
Inventargate, Selbsttest und generierte Lesefassung binden zusätzlich S38, S54,
S57–S66 sowie S68/S69 und die tatsächlichen neuen Grafikanker ein.

## Manager und Tranchenstatus – Slice 7

`designsystem-manager.test.mjs` prüft Tokenfarben und additive Rollen der
Manager-/Profil-/Dialog-/Statusquellen, echte erzeugte Fragmente, explizite
deutsche Text-/Zahlenerwartungen (seit Slice 8), unveränderte Lots und die vier
Bestandszustände. Cashwarnung, Altfall und wirksame Korrektur bleiben getrennt.
V11/V12/V24 werden mit dem Inventargate am tatsächlichen Erzeuger geprüft;
entfernte additive Klassen, unbenannte Symbolaktionen, Altfarbzuweisungen,
Textdeckkraft und unbekannte Aliase sind scheiternde Gegenproben.

Der Profiltest vergleicht normalisierte Werte, vorhandene Sperre, alle
Profil-Speicherkeys bytegleich, stabile Begründungs-ID und erhaltene fremde
Hilfebezüge beim wiederholten Wechsel zwischen Null und positiven Einkommen.
Fehlende/versteckte Begründung und entfallene Sperre scheitern.

```sh
node tests/run-single.mjs tests/designsystem-manager.test.mjs
node tests/run-single.mjs tests/profile-asset-values.test.mjs
node tests/run-single.mjs tests/tranchen-manager-renderer.test.mjs
node tests/run-single.mjs tests/tranchen-manager-page.test.mjs
node tests/run-single.mjs tests/tranchen-manager-modal.test.mjs
node tests/run-single.mjs tests/depot-tranchen-status.test.mjs
node tests/run-single.mjs tests/designsystem-foundation.test.mjs
node tests/run-single.mjs tests/designsystem-components.test.mjs
node tests/run-single.mjs tests/funktionsinventar.test.mjs
node tests/browser-smoke.test.mjs --only=depot-tranchen-manager.html
```

Die vorhandenen registrierten Browserfälle für Manager, Kursfehler und Recovery
sind ergänzt; Browserassertions sichern Rentenherkunft nach Autosave/Reload,
Statistik/Tabellenrollen, Dialogabbruch, Fehlerfarben und Doppel-Submit/Busy-Schutz.
Fokus nach Abbruch/Escape bleibt geprüft; der bestehende F-06-Befund nach
Commit/DOM-Austausch ist weiterhin offen. Der Browserlauf ist sandboxbedingt
mit `listen EPERM` nicht ausführbar. Die volle Suite führt der Orchestrator aus;
Quellenprüfung und Registrierung ersetzen keine Browserabnahme.

## Container und Datenanzeigen – Slice 8

Nachtrag Slice 1 ergänzt `designsystem-display-contract.test.mjs` mit vollständigen
synthetischen UTF-8-Zeugen der tatsächlichen Kopier-/Exportfunktionen: Rohdiagnose
über `formatDiagnosisPayload` und `generateDiagnosisText`, Backtest CSV/JSON sowie
Szenariolog CSV/JSON. LF und CRLF bleiben exakt geschützt; Rohobjektgleichheit
wird zusätzlich geprüft. `balance-diagnosis-copy-contract.test.mjs` und
`balance-diagnosis-format.test.mjs` bleiben unveränderte Lesegates.
Zusätzliche feste JSON-/CSV-Zeugen aus dem unveränderten Basiscommit schützen die
aktuelle `exportBacktestLogData`-Aktion bis zum Blob, einschließlich Dateiname
und MIME-Typ. Die Legacy-Backtestspaltenzeugen bleiben getrennt erhalten.

`designsystem-data-display`, `depot-tranchen-status` und `designsystem-tools`
prüfen 75 Prozent an den echten Zusammenfassungs-, Status-, Tabellen-, Sweep-
und Optimizegrenzen mit je bisheriger Genauigkeit und exakt U+00A0. Legacy-
Formatterassertions bleiben getrennt. `designsystem-charts` behält die alten
Geometrie-/Zahlendigests mit gezielter Textnormalisierung und separaten
U+00A0-Labelassertions. `svg-images.test.mjs` entdeckt alle SVGs unter
`assets/images/` und verwendet den strikten DOM-freien `svg-xml-contract.mjs`;
scheiternde Syntaxgegenproben und Handbucheinbindungsabgleich sind enthalten.

Die Browserfälle `Designsystem components`, `Designsystem tools`,
`Simulator Sweep integration`, `depot-tranchen-manager.html` und `Handbuch.html`
enthalten die Fokus-, Prompt-, Anzeige- und echten XML-Parserprüfungen. Diese
Fälle außerhalb der Sandbox ausführen; die volle Node-Suite fährt ausschließlich
der Orchestrator. Gezielte Beispiele:

```sh
node tests/run-single.mjs tests/designsystem-display-contract.test.mjs
node tests/run-single.mjs tests/designsystem-data-display.test.mjs
node tests/run-single.mjs tests/designsystem-charts.test.mjs
node tests/run-single.mjs tests/svg-images.test.mjs
```

`designsystem-layout.test.mjs` prüft echte Container-/Schrumpfregeln und benannte
Tastaturregionen. Gegenproben entfernen `min-width: 0`, ergänzen eine feste
Seitenspalte, entfernen Scrollkapseln und sichtbaren Auswahlvolltext oder
verhindern den Umbruch; jede Gegenprobe scheitert. Globales Abschneiden und der
Verlust datenabhängiger SVG-Breiten werden ebenfalls verworfen. Die reine
Auswahltexthilfe wird bei Optionenrefresh und `change` mit Werterhalt geprüft.

`designsystem-data-display.test.mjs` prüft deutsche Zahlen und ISO-UI-Tage,
Ratio-/Prozentwertskalierung, Null/fehlend/nicht anwendbar/zulässiges Unendlich,
ein `%` je MiniSummary-Wert, Managerpreise und Gewinne, Jahres-/Matrixprofilbezug
sowie synthetische Verläufe ohne Datenmutation. `formatting.test.mjs` schützt
weiterhin den unveränderten alten Vertrag `12.3%`.

Gezielt: `node tests/run-single.mjs tests/designsystem-layout.test.mjs` und
`node tests/run-single.mjs tests/designsystem-data-display.test.mjs`; dazu
Summary-, Manager-, Profil-, Zahlenboundary-, Ausgaben-/Verlaufstests und
Inventargate. Die volle Suite fährt im orchestrierten Lauf der Orchestrator.

Browser: `node tests/browser-smoke.test.mjs --only="Designsystem data layout"`.
Der registrierte Fall prüft bei 1366/1920/2560 px lange Profil-/Tranchennamen,
sichtbaren Volltext nach Auswahlwechsel/Reload, gefüllte Tabellen, aktive und
inaktive Balance-Verläufe, interne Pfeiltastenbedienung mit Fokuserhalt sowie
bestehende Druckausblendung und DOM-Reihenfolge. Die vorhandene
Vermögens-Layoutmatrix umfasst zusätzlich 2560 px und prüft die Ausgabenmatrix
mit erhaltener Mindestbreite im eigenen Scrollcontainer. Sämtliche Daten sind
synthetisch. Der Startversuch in der Agentensandbox endet mit `listen EPERM`;
der Fall ist damit implementiert, aber dort nicht browservalidiert. Externe
Browserabnahme vor Merge bleibt erforderlich.


## Simulatorbreiten und vollständiger Quellvertrag – Slice 9

`designsystem-layout.test.mjs` prüft `validateCompletePresentation` über sämtliche
explizit gelisteten Laufzeitquellen. Jede neue Layoutregel und Text-/Elterndeckkraft
(einschließlich JS-Textflächen), Aliaszyklen, fehlende Aliase, Rahmenrollen als
Text, falsche Kontrastpaare, Prioritäten, unbenannte Regionen und ungekapselte
SVG-/Tabellenausgaben haben isolierte scheiternde Gegenproben.
`designsystem-data-display` erhält binäre Halbwert-Rundungen und prüft echte
Logformatter samt Prozent-/Ratio-/CAPE-Skalierung und unveränderten Rohdaten.
`simulator-heatmap` prüft Null, fehlend, N/A/Grund, ∞ und Kleinstwerte einzeln.

Die Chart-/Championdigests basieren auf `cdef93e7`; nur Dezimalzeichen in
Texten, additive Scrollkapseln und die ausdrücklich geänderte Fehlzellenbeschriftung
werden normalisiert. SVG-Attribute/Pfadkoordinaten bleiben exakt geschützt.
Die alten Parser-/Exporttests werden unverändert ausgeführt.

Gezielte Ausführung erfolgt weiterhin mit `node tests/run-single.mjs <datei>`.
Alle Designsystemdateien, `formatting`, `canonical-number-boundary`,
`results-renderers`, `simulator-heatmap`, `simulator-log-columns`,
`historical-backtest-export`, `monte-carlo-export-contract`,
`stress-replay-renderer`, `simulator-sweep-consumers` und das Inventargate
gehören zum Abschlussnachweis. Die volle Suite fährt der Orchestrator.

Die registrierten Fälle `Designsystem simulator layout`, `Designsystem tools`
und `Designsystem simulator results` messen gefüllte Ergebnis-/Werkzeughosts,
interne Scrollregionen, lange native Auswahlen, Tastatur/Fokus und Druck
bei 1366/1920/2560 px nach Fontload. Reale Backtest-/Sweep-/Built-in-Läufe bleiben
kurz. Der Browser-Smoke wird außerhalb der Sandbox ausgeführt; Quell-/Nodeprüfung
und die bloße Registrierung dürfen nicht als Browserabnahme berichtet werden.

Der kurze Werkzeug-Browserfall kann eine konstante Sensitivitätsmetrik liefern.
In diesem Fall füllt ausschließlich die Sensitivitätsanzeige eine synthetische
Varianzfixture; echte Sweepdaten, Ranking und Übernahme bleiben unverändert.


### Nachtrag: bestätigter Profilwechsel und bedarfsgerechte Auswahlvolltexte

`profile-ui-contract.test.mjs` betreibt den echten initialisierten Handler mit
kontrollierten Timern und einem offenen Adapterpromise. Auswahl, Volltext,
Badge, aktuelle ID und Cache werden unabhängig von `rs_current_profile` und
`rs_active_profile` im bestätigten Adapter geprüft. C während B erzeugt keinen
weiteren Flush/Write; Flushfehler, fehlendes Ziel und Recovery lösen die Wache.
Der unmittelbar folgende Neuaufbau liest nur den Adapter, ohne Testflush.
Andere Schreibvorgänge bleiben entprellt.

`designsystem-selection-text.test.mjs` wird als `*.test.mjs` automatisch entdeckt
und liefert gezählte Assertions. Deterministische Control-/Schriftmessungen
prüfen lange/kurze Optionen, Resize, Fontladung, Sichtbarwerden, native Setter,
Optionsersatz, Reset, ARIA und Idempotenz. Der echte Manager-Initialisierer
schließt alle statischen IDs und die dynamische Cashstatuswahl nach Rendern an.
Alte Mocks ohne Geometrie gelten ausdrücklich nicht als Kürzungsbeleg.

Browser: `node tests/browser-smoke.test.mjs --only="Designsystem data layout"`.
Der Fall misst Profilgrenzen vor/nach Reload über unabhängiges IndexedDB-Lesen,
wartet auf aktuellen Produkterfolg und lädt ohne festen Zeitaufschlag oder
Testflush der Wechselaktion neu. Drei Managerauswahlen erhalten getrennte
lange/kurze Textfixtures bei 1366/1920/2560 px. Modalreset und bestehende Fokus-,
Scroll-, Druck- und Überlaufprüfungen bleiben enthalten. Mit
`PROFILE_DIAGNOSTIC=1` liefert derselbe Fall die Diagnose ohne Erfolgswarten und
protokolliert Auswahl, Volltext, aktuelle ID, Cache und bestätigtes Backend vor
und nach sofortigem Reload. Für die Ursachenzuordnung muss die Steuerung diese
Diagnose auch mit dem unveränderten Produktstand ausführen; B im Cache beweist
keine Dauerhaftigkeit. Gemeinsame Browserhelfer prüfen Textgleichheit stets,
Sichtbarkeit ausschließlich bei Kürzung. Browserausführung durch Steuerung ausstehend.

### Nachtrag R8: Nullrichtungen, Exaktwertkarten und kleine Darstellungsbefunde

Gezielte Läufe über `node tests/run-single.mjs <datei>`:
`results-metrics`, `results-renderers`, `designsystem-simulator-results`,
`designsystem-tools`, `auto-optimizer`, `tranchen-manager-renderer`,
`designsystem-manager`, `profile-asset-values`, `designsystem-balance` und
`designsystem-start-handbook` (jeweils `tests/<name>.test.mjs`). Die bestehenden
Viewmodel-Digests schützen weiter alle Zahlen, Texte, Gründe und übrigen Töne;
die R8-Projektion führt ausschließlich die acht benannten neutralen Karten auf
ihre früheren Töne zurück. Echte Renderer prüfen Null/-0, beide Vorzeichen,
Kleinstwerte, Fehlwerte und unveränderte Rohdaten; Optimize-Textdigests und der
deutsche Progressvertrag bleiben erhalten. Der Rententest verwirft doppelte
Gründe und den alten statischen Hinweis und prüft einen neuen Reload-DOM.

Nach Inventaränderungen Lesefassung ausschließlich mit
`node scripts/generate-funktionsinventar.mjs` erzeugen; anschließend
`node tests/run-single.mjs tests/funktionsinventar.test.mjs`,
`node tests/funktionsinventar-contract.mjs --self-test`,
`node tests/funktionsinventar-contract.mjs --check` und
`node scripts/generate-funktionsinventar.mjs --check` ausführen. V03 und die
historischen Kennungen bleiben erhalten, der dynamische Grund ist geschützt.

Die Steuerung führt die bestehenden Browserfälle `Designsystem simulator results`,
`Designsystem tools`, `Designsystem Balance`, `Designsystem foundation`,
`Designsystem data layout` und `depot-tranchen-manager.html` aus, z. B. mit
`node tests/browser-smoke.test.mjs --only="Designsystem foundation"`.
Die Ergänzungen messen echte neutrale KPI-/Nebenwerte, Stresswarnrollen,
Optimize-Null-/Vorzeichenfarben, Nullgewinn, Symbol-/Titelabstand über Text-Range,
Profilkachel-/Checkboxgeometrie und genau eine Rentenerklärung nach Init,
Einkommensänderung und Reload. Geometriebreiten bleiben 1366/1920/2560 px;
kurze und lange Namen sind getrennte Gegenfälle. Registrierte Fälle und fachliche
Bedien-/Export-/Übernahmeassertions bleiben erhalten. Node- und Syntaxprüfungen
ersetzen die Browserabnahme nicht. Browserausführung durch Steuerung ausstehend.


### Rahmen und Profilübergabe – Paket 2a, Slice 1

- `suite-frame.test.mjs` wird automatisch entdeckt und prüft alle fünf statischen
  Seiten samt exakter HTML-Seitenkennung und Gegenproben für fehlende/falsche Werte,
  echte benannte Ziele, Aktivzustand, Managerexportverzicht, lokalen Anschluss,
  gemeinsame Farb-/Quellenkontrolle, Druckanker und tatsächliche frühe Modulbindung.
  Der Balance-Modulautostart muss den bestehenden Unterseiten-Lifecycle erreichen.
- `profile-navigation.test.mjs` prüft Export → Flush → genau einen Wechsel,
  Deferred-Bereitschaft/Flush, Fehler und Wiederholung, abwartbare unbelegte Hooks,
  Ausnahmen, idempotente Start-/Unterseiten-/Handbuchinitialisierung, BFCache,
  DOM-Ersatz, abgetrennte Links und Sperre nach bestätigtem Wechsel.
- `persistence.test.mjs` prüft unveränderten Hookstandard sowie den Handbuch-Opt-out
  einschließlich Tauri-Schließhooks und weiterhin funktionierendem explizitem Flush.
- Lokale Rahmensymbole bleiben in `designsystem-icons.test.mjs` unter dem bestehenden
  SVG-/Quellenschutz. Das Rahmenstylesheet gehört zum Designsystem-Quellmanifest.
- Browserfälle `Suite frame handoff`, `Suite frame failures`, `Suite frame print`
  und `Suite frame counterprobes` sind in `browser-smoke.test.mjs` registriert.
  Der Druckfall prüft davor auf jeder Seite die HTML-Kennung, gefüllte Rahmensymbole
  und die Body-Regel; beim Druck muss der Body-Abstand vollständig verschwinden.
  Vor Produktinitialisierung installierte Beobachtung hält den echten Handoff-Flush
  offen und misst Exportreihenfolge, unveränderte URL, Navigationszahl und Zielprofil.
  Die fünf mal fünf Linkmatrix enthält aktive Links; Marke, Startkarten und der
  Balance→Manager-Einstieg kommen hinzu. DOM-Ersatz und absichtlich abgeschalteter
  Binder/Umgehung/entferntes Bedienziel sichern die positive Prüfung gegen Blindheit.

Die bestehende Balance-Layoutmatrix misst jetzt die tatsächliche `.suite-content`-
Breite statt der Fensterbreite für die 1250px-Spaltenumschaltung; 1250/1251px werden
zusätzlich bei unverändertem Fenster gesetzt und geprüft. Sichtbare Tabtitel,
interne Scrollkapseln, Drawer und Druck bleiben verpflichtend. Frühere Angaben
zur 1250px-Fenstergrenze beziehen sich auf den Stand vor dem Rahmen.

Gezielte Node-Läufe erfolgen mit `node tests/run-single.mjs tests/<datei>.test.mjs`.
Inventarprüfung: `node scripts/generate-funktionsinventar.mjs --check`.
Die volle Node-Suite führt im orchestrierten Lauf ausschließlich der Orchestrator aus.
Browserfälle laufen außerhalb der Sandbox, einzeln beispielsweise mit
`node tests/browser-smoke.test.mjs --only='Suite frame handoff'`; ein fehlgeschlagener
Port-/Browserstart in der Sandbox ist kein Laufzeitnachweis.


### Suite-Kontext und Leistenpräferenz (Paket 2a, Slice 2)

- `profile-context-reader.test.mjs`: gültige/fehlende/beschädigte/widersprüchliche IDs,
  reine Textausgabe, getrennte Haushaltsanzeige und null Mutationen durch Reader/Rendern.
- `suite-frame.test.mjs`: tatsächliche verzögerte Persistenzbereitschaft, Ladezustand,
  Handbuch ohne Bootstrap, Rahmen-/Druckstruktur und 12-/4rem-Budget unter 82rem.
- `suite-sidebar-preference.test.mjs`: tatsächlicher Container-/Klickadapter, Rückkehr
  zur manuellen Wahl, keine Writes beim Resize, Speicherfehler und echte Capture-,
  Bundle-, Vollbackup- und Snapshotwege ohne Gerätepräferenz.
- `profile-ui-contract.test.mjs`: Kopf/Badge während offenem Flush und abgewehrtem
  Zweitwechsel; bisherige Adapterabschluss- und Recoveryassertionen bleiben erhalten.

Browserfälle sind als `Suite frame profile context`, `Suite frame profile history`,
`Suite frame bfcache` und `Suite frame widths` registriert. Sie prüfen SOURCE auf
allen Seiten, Profil A/B/Zurück/Vor mit sichtbaren aktuellen Ergebnissen, 1366/1920px,
schmalere äußere und Inhaltscontainer im selben Fenster, interne Tabellenüberläufe,
Tastatur, Wiederverbreitern und Gerätespeicherfehler beim Handoff. Der BFCachefall
meldet Erfolg nur nach realem `pageshow.persisted === true`; sonst lautet der
separate Befund „nicht beobachtet“, auch bei erfolgreicher normaler Historienrückkehr.

Gezielt: `node tests/browser-smoke.test.mjs --only='Suite frame widths'` (analog
für die übrigen Namen). In der Implementierer-Sandbox scheitert der Serverstart
mit `listen EPERM`; Browserausführung und tatsächliche Breiten-/BFCachebelege
bleiben der gesteuerten Sitzung vorbehalten. Volle Node-Suite: nur Orchestrator.


### Endgültige Navigation (Paket 2a, Slice 3)

`suite-frame.test.mjs` schützt entfernte native Startlinks, erhaltene Hilfe im
neuen Tab, Fach-/Druck-/Recoveryanker und den eindeutigen delegierten
`#managerBackLink`; Gegenproben entfernen Hilfe oder Bindung und verdoppeln die ID.
`tranchen-manager-page.test.mjs` verwendet den tatsächlichen Rahmenlink als
DOM-Grenzadapter und misst die Profil-ID-/ARIA-Aktualisierung des unveränderten
Erzeugers. Die Foundationprüfung schützt die tatsächlichen Rahmenfarben mit
wirksamen Kontrastmutationen; Kapitel-, Karten-, Quellenschutz und Inventargates
bleiben bestehen.

Registriert: `Suite frame navigation replacement`. Der Fall aktiviert alle vier
ersetzten Rückwege mit Maus und Enter, hält Flush offen, misst genau einen
Wechsel, öffnet Hilfe im neuen Tab, betätigt Karten/Manager-Einstieg, Diagnose,
Jahresabschluss-Preflight und beide Recoveryziele einschließlich Backupfokus.
TOC und Schnellstart werden mit Hash-/Fokus-/Reiterzustand geprüft. Er wiederholt
Fehlerfälle und Gegenproben: entfernte Rückwege, fehlender Binder und native
Umgehung müssen auf jeder Seite den Handoffnachweis brechen. `Suite frame print`
und `Suite frame widths` prüfen die endgültige DOM-Struktur separat.

Gezielter Versuch: `node tests/browser-smoke.test.mjs --only='Suite frame navigation replacement'`
scheitert hier bereits beim Serverstart mit `listen EPERM`. Syntaxprüfung und
Node-Tests sind keine Browserabnahme. Volle Node-Suite bleibt beim Orchestrator;
Browser-/Layout-/BFCache-/EXE-Abnahme fährt die gesteuerte Sitzung. BFCache-Erfolg
wird ausschließlich nach beobachtetem `pageshow.persisted === true` berichtet.

### Abschluss des Navigationsschutzes – Reset, Profil und Historie

Gezielte Node-Dateien (jeweils `node tests/run-single.mjs tests/<name>.test.mjs`):

- `navigation-guard-reload`: Abbruchenden vor Mutation, eigener Commit bis Flush,
  Singleflight, Flush-false/Ausnahme, neue Eingaben/fremde Commits und Wiederholung.
- `balance-ui-orchestration` und `simulator-ui-orchestration`: tatsächliche
  Resethandler, Ablehnung mit erhaltenen Werten, offener Flush und ortsfester
  Fehler mit erneut bedienbarem Knopf; kein zusätzlicher Testflush als Abschlussbeleg.
- `profile-ui-contract`: tatsächlicher Profiladapterwrite bis bestätigter ID und
  UI-/Fehlerfortsetzung; Recoveryexportpflicht, Ablehnung, Commit, Flushfehler und
  Wiederholung ohne zweiten Export. `profile-navigation`: tatsächlicher
  BFCachehandler mit alten Freigaben, erneuter Entscheidung, Flush und Schlussprüfung.
  Ein gehaltenes altes Handoff-Flushende beweist zusätzlich: kein alter Zielwrite,
  automatisch nachgeholte neue Entscheidung und genau ein Reload erst nach eigenem
  bestätigtem Flush. Bleiben, Flush-false/Ausnahme sowie Input/Change während des
  Wartens oder des neuen Flush verhindern Reload; doppelte Rückkehrereignisse
  erzeugen keinen zweiten Versuch und die Beobachter werden aufgeräumt.
- Regressionen: `auto-optimize-cancellation`, `balance-annual-navigation`,
  `balance-wealth-history`, `designsystem-layout`, `navigation-guard`,
  `navigation-guard-dialog`, `profile-storage`, `simulator-household-needs-persistence`,
  `suite-frame`, `suite-sidebar-preference`, `tranchen-manager-modal`.
- Inventar: Einzelrunner für `funktionsinventar.test.mjs`, Vertragshelfer
  `--self-test` und `--check`, Generator `--check`. Historische Kennungen,
  `sourceRevision`, Funktions-/Anker- und Größenlimits bleiben bestehen.

Neue registrierte SOURCE-Browserfälle, einzeln durch Steuerung auszuführen:

```sh
node tests/browser-smoke.test.mjs --only='Navigation guard resets and recovery'
node tests/browser-smoke.test.mjs --only='Navigation guard profile writes'
node tests/browser-smoke.test.mjs --only='Navigation guard browser history'
```

Reset/Recovery hält den echten Flushaufruf des Resethandlers an, misst Ablehnung,
Mutation, gesperrte Appnavigation, false/Ausnahme/neue Eingabe und erfolgreichen
Retry ohne Bundleexport. Die Simulatorprobe besitzt ein echtes kleines
Backtestergebnis; Recovery prüft den Download der korrupten Rohbytes.
Profilwrites halten den tatsächlichen IndexedDB-Adapterbatch vor Write an und
prüfen App-Enter, bestätigte IDs getrennt von lokaler Anzeige, Fehler/Erfolg
und erneut möglichen Handoff. Der Historienfall baut echte Dokumenthistorie
auf und fährt Zurück und Vor jeweils mit nativer Ablehnung und Annahme.
`Navigation guard native paths` prüft zusätzlich Reload und
`page.close({ runBeforeUnload: true })` nach echter Aktivierung. Alle nativen
Versuche messen genau eine Nachfrage; Ablehnung prüft unveränderte
Dokumentidentität/Editorwerte, Annahme den realen Ziel-/Schließzustand.

Abschlusskatalog: alle registrierten Schutzfälle einzeln wiederholen –
`Navigation guard links`, `Navigation guard calculations`,
`Navigation guard optimizer and backtest`, `Navigation guard modal`,
`Navigation guard manager commits`, `Navigation guard manager dirty inputs`,
`Navigation guard manager price preparation`, `Navigation guard imports`,
`Navigation guard imports native`, `Navigation guard snapshot restore`,
`Navigation guard wealth writes`, `Navigation guard annual finalization`,
`Navigation guard annual`, `Navigation guard annual native`,
`Navigation guard native paths`, `Navigation guard tauri protocol` und die drei
neuen Fälle. Danach sämtliche anderen registrierten Browserfälle und gesamtes
`npm run test:browser` auf genau dem final geprüften SOURCE-Stand. Insbesondere
`Suite frame profile history`, `Suite frame bfcache`, `Suite frame widths`,
`Suite frame navigation replacement`, `Suite frame failures`, die Haushaltsreloads
und die bestehenden Fach-/Export-/Profilprüfungen bleiben verpflichtend.
BFCache zählt nur bei real beobachtetem `pageshow.persisted === true`; normale
Historienrückkehr wird getrennt berichtet.
`Suite frame bfcache` prüft zusätzlich mit einem ausdrücklich synthetischen
Lifecycleereignis einen gehaltenen Handoff am echten Binder: automatische neue
Nachfrage und einmaliger echter Reload, Bleiben sowie Eingabe während des Wartens.
Dieser Teil ersetzt keinen real beobachteten BFCache-Nachweis.

Der Implementierer hat Syntax und gezielte Nodepfade geprüft. Ein Versuch des
neuen Historienfalls scheitert bereits beim Serverstart mit `listen EPERM`;
das ist kein Browsererfolg. Volles `npm test` bleibt Aufgabe des Orchestrators.
Die externe Steuerung prüft zusätzlich mit Offline-Toolchain die Rusttests
(`cargo test --offline --manifest-path src-tauri/Cargo.toml`) und eine lokale
Kandidaten-EXE aus demselben Quellstand mit getrenntem synthetischem Datenspeicher.

EXE-Abnahmekatalog: Jahrescommit länger als drei Sekunden anhalten; Schließen,
Jahresdialog-Escape/Knopf/Overlay und wiederholtes Schließen bleiben gesperrt.
Nach übernommener Nachfrage, langsamem Flush, Flushfehler oder später fehlender
JS-Antwort bleibt das Fenster offen, auch nach mehr als drei Sekunden. Nur
bestätigter Erfolg schließt einmal. Bleiben/Fehler/Sperrende erlaubt einen neuen
Versuch; alte Kennungen/Antworten/Timer beeinflussen ihn nicht. Getrennt den
Fallback vor Übernahme bei fehlendem Listener/nicht antwortendem JS prüfen:
nach drei Sekunden einmal schließen. Handbuch besitzt ebenfalls EXE-Schließschutz,
aber keine automatischen Profilspeicherhooks. Tauri-Doppel-/Node-/Browserproben
sind keine reale Rust-/EXE-Abnahme. Diese Prüfungen sind extern offen.
Erzwungenes Ende bleibt Recovery; keine Browser-/Betriebssystemkürzelsperre und
keine garantierte asynchrone Unloadspeicherung wird behauptet. Produktquellen
enthalten keine neu gebauten Artefakte; Ergebnisablage folgt erst in 4.2.


## Früher Profilspeicherbeginn und Tauri-Testführung (Paket 2b, Slice 1)

`profile-navigation.test.mjs` betreibt den tatsächlichen Profilsaver und die echte
Facade mit einem synthetischen Adapter. Nur `beforeunload` muss den neuesten
Profilsnapshot im ersten Batch sichern; die Gegenprobe lässt ausschließlich den
Zusatzlistener aus und beginnt keinen Batch. Kein nachträglicher Testflush dient
als Erfolgsbeleg. Das Ereignisdoppel bildet mehrere Listener, Capture/Bubble,
Microtask-Checkpoints, `defaultPrevented` und `returnValue` ab. Die kombinierte
Probe bindet den echten zentralen Nachfragehandler nach Identität an, prüft
weitere Eingaben nach nativer Ablehnung sowie Fachwerterhalt bei wiederholten
Anlässen. Die bisherigen Pagehide-/Hidden-Gegenproben und BFCache-Fortsetzungen
bleiben bestehen. Gehaltene fremde Commits und Schlüssel-/Präfixschreibsperren
beginnen weder Saver noch eigenen Flush, während der Besitzerflush weiterläuft.
`persistence.test.mjs` prüft die rein lesende Sperrabfrage mit mehreren Besitzern
und einem Reset bei noch aktiver Sperre.

`Navigation guard tauri protocol` speichert Dokumentkennungen, Mainframewechsel
und Pagehide-/Pageshow-/Sichtbarkeitsereignisse vor den Closeversuchen im
Testprozess und pro Dokument. Im Cleanup-/IPC-Abschnitt ersetzt eine gezielte
Test-Modulroute nur die letzte Reload-Endfunktion des gemeinsamen Guards.
Schutzentscheidung, echter Flush, Commitbesitz und Schlussvalidierung bleiben
aktiv. Pagehide-Cleanup, synthetische BFCache-Fortsetzung und Hidden→Visible-
Refresh werden getrennt geprüft. Der Folgeclose wartet auf gezählte Reloadenden,
gleiche Dokumentidentität und einen freien Guard; kein Zeitpolster ersetzt dies.
Alle bisherigen Tauri-Blöcke einschließlich des tatsächlich gehaltenen Jahreswrites
über drei Sekunden bleiben verpflichtend. Synthetische Lifecycleereignisse und
das Reload-Enddoppel beweisen weder eine reale BFCache-Rückkehr noch native
Rust-/EXE-Funktion.

Gezielte Node-Läufe: alle `.test.mjs` der Slice-1-Pfadliste außer Browser-Smoke über
`node tests/run-single.mjs <pfad>`; Browsersyntax über
`node --check tests/browser-smoke.test.mjs`. Die volle Suite `npm test` führt der
Orchestrator aus. Die Steuerung bestätigt einzeln `Simulator household needs reload`,
`Navigation guard tauri protocol`, `Navigation guard native paths`,
`Navigation guard annual native`, `Suite frame bfcache`, `Suite frame handoff`
und `Navigation guard modal`. Nur der echte Haushaltsreload belegt den erhaltenen
Floor nach sofortigem Reload; die Nodeprobe belegt den früheren Speicherbeginn.
Browser-/EXE-Erfolg bleibt bis zur externen Durchführung offen.

## Dialogretry und vollständige Browsermatrizen (Paket 2b, Slice 2)

Die fokussierten Manager-/Modaltests benutzen echte gebundene Click-/Submitpfade,
gehaltene Writes und Rollbackenden. Sie prüfen ursprüngliche IDs, Zeitpunkte und
bestätigte Backendbytes, Doppelklick, parallelen Submit, erneuten Fehler und fremde
Commitbesitzer. Folgeeingaben nach Fehler oder während Retry bleiben offen und
geschützt. Eine identische neue Dialogöffnung schließt nicht durch alten Erfolg;
Select/Checkbox gehören zur Signatur. Folgesubmit einer neuen Tranche bearbeitet
die bestätigte ID; ein erledigter Casheditor erzeugt keinen Folgeauftrag.
`designsystem-manager.test.mjs` prüft die echten statischen/dynamischen Knöpfe mit
`type="button"`, Namen und bestehender Aktionsklasse außerhalb ersetzbarer Hosts.

Die Steuerung bestätigt jeden geänderten Browserfall einzeln mit
`node tests/browser-smoke.test.mjs --only='<Fallname>'`:

- `Navigation guard manager commits`: Tranche, Cashbestätigung, Cashkorrektur ×
  Erfolg/Fehler. Regulärer Mausclick auf `#retryTrancheDialogSaveBtn` beziehungsweise
  `#retryCashPostingSaveBtn`, sichtbarer Speicherfehler, echte Write-/Rollbackenden
  und Backenddaten/IDs. Der gehaltene EXE-Versuch nutzt die kontrollierte
  Protokolluhr über drei Sekunden; kein Zeitpolster ersetzt die Commitbarriere.
- `depot-tranchen-manager.html`: zwei unsaubere Abgleichrückwege verlangen
  Verlustzustimmung. Separater sauberer Rückweg mit bestätigtem Bestand verlangt
  keine Nachfrage; die Startseite besitzt keine offene Dialog-/Overlayebene oder
  Inhaltssperre, ihre Balancekarte wird regulär per Maus bedient.
- `Navigation guard snapshot restore`: weiterhin acht Varianten, Standard und
  Vollrecovery × `read`, `write`, `rollback`, `input`. Archivvergleich bytegenau
  unter `archived.snapshot.records`; Daten-, Besitzer- und Schreibschutzorakel
  bleiben erhalten.
- `Navigation guard imports`: 15 Varianten, drei Arten × `file`, `flush`,
  `snapshotRead`, `write`, `rollback`. `Navigation guard imports native`: ebenfalls
  15 Varianten, dieselben Arten × `file`, `flush`, `snapshotRead`, `write`, `rollback`. Vollbackup benutzt
  vollständig `index.html` mit echtem Dateifeld und Nutzeraktivierung; JSON/CSV
  benutzen Balance mit Wealth-Bereitschaft. URL, Bereitschaft nach Reload und
  Nachprüfung folgen derselben Seitenauswahl. Nach Vollrollback bleiben
  Recoverymeldung und archivierter Snapshotbestand erhalten; echte Wiederherstellung
  über Startkarte → Balance → Snapshots. Keine neue Startseiten-Snapshotoberfläche.
- `Navigation guard resets and recovery`: unverändert 14 Varianten, Balance und
  Simulator × `false`, `throw`, `input`, `change`, `foreign`, `cancel`, `success`.
  Balance installiert den Wealth-Beobachter vor seinem Idle-Orakel.
- `Designsystem recovery banner`: Persistenz-/Profilbereitschaft, Fokus auf dem
  Importknopf unmittelbar vor Enter und getrennte Maus-/Tastaturöffnung desselben
  `fullBackupImportFile`. Der echte Inline-Renderer-Nodevertrag bleibt bestehen.

Gezielte Nodeprüfungen einschließlich Inventarvertrag und Generatorkonsistenz
ersetzen keine Browserabnahme. Die volle Suite `npm test` gehört zum Orchestrator;
Browserkatalog, vollständiger Smoke sowie Rust-/EXE-Abnahme bleiben bis zur
Bestätigung durch die Steuerung offen. Slice-1-Browserfälle werden auf dem finalen
Stand ebenfalls erneut geprüft.


### Restliche Browserfälle und Resetmeldung (Paket 2b4, Slice 1)

`balance-smoke.test.mjs` beendet seine übrigen Fachproben vor dem terminalen
Resetnachweis. Er verwendet den echten `UIBinder.handleReset`, die bereits beim
Appstart initialisierte Facade, ihren originalen localStorage-Adapter sowie
`balanceMain.update({ mode: 'persist_inputs' })` mit originalem Laden/Migration.
Ein Adapter-Deletefehler erzeugt einen tatsächlich unbestätigten Flushabschluss;
ein bestätigter Retry mutiert nicht erneut und sein Reloadcallback scheitert
kontrolliert. Beide Phasen prüfen `ok: false`, `PERSISTENCE_RELOAD_REQUIRED`, den
exakten Original-Sperrtext, sämtliche Cache-/Adapterbytes, entfernte Resetkeys,
Registry und `window.name` nach Folgeinput und echtem gesperrtem Profilhandoff.
Unbestätigt gilt „Reset noch nicht dauerhaft bestätigt …“, bestätigt exakt
`RESET_RELOAD_REQUIRED_MESSAGE`. Die Facade wird dafür weder neu konfiguriert
noch zurückgesetzt; keine manuelle Guardfreigabe überwindet die Resetsperre.
Der UI-Orchestrierungstest setzt für seine zusätzlichen Ladeproben ausdrücklich
`loadState` auf die gesicherte Originalmethode und stellt das vorherige Doppel
anschließend wieder her. Er ersetzt nicht den echten Main-Update-Nachweis.

Die beiden Importmatrizen enthalten jeweils `full/json/csv ×
file/flush/snapshotRead/write/rollback` (je 15). Die Restorematrix bleibt
Standard-/Vollrecovery × `read/write/rollback/input` (acht). Vollimport läuft
über `index.html`, JSON/CSV über Balance. Native Zustimmung ersetzt das Dokument
und hinterlässt keinen alten flüchtigen Besitzer. Beim Dateilesen und ersten
Vorbereitungsflush existiert noch kein Recoverypunkt; ab `snapshotRead` sowie
bei `write` und `rollback` bleibt der archivierte Recoverypunkt erreichbar.

`installReplaceAdapterBarrier` installiert vor `goto()` eine ausschließlich im
Browsertest wirksame Modulroute am eindeutigen Adapteranker
`async replaceLiveRecords(records, options = {}) {`. Erst unmittelbar vor dem
Prüfvorgang aktiviert die Probe ihren zurückgesetzten Zähler: erster Replace
bei Write/Restore-Input, zweiter Replace bei Rollback. Die Pause liegt vor dem
Transaktionsbeginn. Die Prüfung verlangt den weiterhin identischen zuständigen
Commitbesitzer (`persistence-operation` beim Import, `navigation-mutation` beim
Restore); bloßes Verbleiben auf der URL reicht nicht. Nach expliziter Freigabe
laufen die ursprünglichen Writes, Backend-/Cache-Readbacks und kompensierenden
Rollbacks. Vollimport-/Restore-Postvalidierungsfehler, JSON-/CSV-Binderinjektion,
Datei-, Flush- und Snapshotlesebarrieren bleiben erhalten. Erfolgreiche Rollbacks
vergleichen sämtliche vorherigen Livewerte als unveränderte Strings und erhalten
Archivrecords bytegleich; Restore prüft außerdem seinen gespeicherten Snapshot.

Nach Bleiben/Escape wartet `waitForNavigationDecisionSettled` im selben Zustand
auf `navigationGuardDialog.open === false` und `isBusy() === false`, bevor der
nächste Versuch beginnt. Vorbereitungsbesitzer und Verlustgründe bleiben erhalten;
der nächste echte Versuch stellt die neue Verlustfrage. Das gilt für Rahmenlinks,
Rechnungsneustarts, Editorfolgeschlüsse, Kurs-/Vermögens-/Import-/Jahresvorbereitung,
Simulator-Reset und die betroffenen Tauri-/BFCache-Folgen. Vollständige
Vorgangsenden werden weiterhin getrennt abgewartet.

Native Cashablehnung und History-Ablehnung erhalten Editor, Werte, Cashaktionen,
Action-/Ziel-/Tranchen-IDs und alle übrigen Registrybytes. Ausschließlich
`.profiles.<zuvor-aktive-id>.meta.updatedAt` wird auf Testkopien aus dem
serialisierten Registryvergleich entfernt. Die aktive Profil-ID muss erhalten
bleiben; andere Zeitstempel und sämtliche Profil-Datenstrings bleiben Teil des
Vergleichs. Der separate Tranchenbestand bleibt vollständig bytegleich.

Die Managercommit- und Jahresfinalisierungsproben übergeben `smoke` an die
Tauri-Probe und warten versuchsgebunden mit `waitForTauriCloseSettled`.
Das kontrollierte Tauri-Doppel ist eine Protokollprobe, keine Kandidaten-EXE-Abnahme.
Gezielte Nodeprüfungen und Syntaxprüfung liefern keinen Browser-Erfolgsstatus.
`npm test` fährt der Orchestrator; Einzelbrowserfälle, vollständiger Browser-Smoke
und echte Schließversuche während Commit/Rollback sowie nach Abschluss in der
Kandidaten-EXE bleiben externe Abnahmen vor dem lokalen Merge.

### Simulator: MC und Werkstatt nach Referenzen 11–18 (Paket 4e)

`simulator-workshop-ui.test.mjs` prüft die dauerhaft sichtbaren Auswahlkarten,
aktive Tönung und Öffnen-/Schließen-/ARIA-Zustände, höchstens eine Fläche,
Fokus und Pfeil/Home/End, den Szenario-Log-Rücklink sowie einmalige Binder
und unabhängige Dokumente. Feld-, Ergebnis- und Controlleridentitäten bleiben
beim Wechsel erhalten; Schließen startet oder beendet keinen Lauf. Der Runner
entdeckt diese Datei automatisch wie alle `*.test.mjs`.

Gezielte Prüfungen über `node tests/run-single.mjs tests/<name>.test.mjs`:
`simulator-workshop-ui`, `simulator-tab-layout`, `mc-result-cockpit`,
`designsystem-simulator-fields`, `designsystem-tools`, `stress-replay-renderer`,
`designsystem-simulator-results`, `designsystem-charts`, `results-renderers`,
`stress-replay-ui`, `simulator-sweep-consumers` und `funktionsinventar`.
Die Druckverträge zeigen auch geschlossene Sweep-/Optimize-Hosts einschließlich
vorhandener Ausgaben. Reiterleiste und Werkzeugkarten bleiben im Druck verborgen;
Medienwechsel verändern weder Werkzeugwahl noch Fokus. Bestehende Fach-,
Präzisions-, S54-Jahreszeilen-/Vier-Serien- und S55-Detailprüfungen gelten weiter.

Die vorhandenen Browserfälle `Simulator.html`, `Designsystem tools` und
`Simulator Monte-Carlo E2E` enthalten erweiterte Kartenbedienung und Druckmatrix;
es wurden keine Browserfälle zusätzlich registriert. Volles `npm test` führt
der Orchestrator aus. Browser-Smoke und Bildvergleich der Referenzen 16–18 bei
1920/2560 px erfolgen durch die Steuerung außerhalb der Agentensandbox und
sind durch diese Dokumentation nicht als bestanden bestätigt.

## Personen & Vermögen – Korrekturen (Paket 5b, Slice 1)

Fokussiert werden `funktionsinventar`, `tranchen-manager-page`,
`tranchen-manager-profiles`, `tranchen-manager-renderer`,
`tranchen-manager-navigation` und `designsystem-manager` jeweils mit
`node tests/run-single.mjs tests/<name>.test.mjs` geprüft. Die Gegenproben sichern
inklusive Inventargrenzen, sichtbaren Profilnamen getrennt von Datenattribut und
Technikkennung, reine Kartenprojektion, Einzel-/Mehrprofiltitel, Kursbelege ohne
Sessionwrites, delegierte Kartenmenüs mit Rückfokus und unveränderte Wechsel-/
Verwaltungs-/Flushverträge. Der Quellvertrag verwirft äußeren Kartenrahmen,
fehlenden Titelhost und einen Verwaltungsöffner innerhalb der Tabrollen.

Tatsächlich angepasste Browserfunktionen sind `createPage`,
`acceptBacktestNavigation` und `runTranchesSmoke`. Ohne explizite `quoteFixtures`
wird vor Appstart ein fester leerer Bericht unter `STARTUP_PRICE_SESSION_KEY`
gesetzt; Kursfälle mit expliziten Fixtures behalten ihre Requests und strenge
Fehlererfassung. Backtestnavigation wartet nach Export/Verlustentscheid auf das
übergebene Linkziel. Der Managerfall nutzt `#managerPageTitle`, öffnet den Verkauf
vor Eingabe der Ausführungs-Kennung, prüft Bestand-/Registry-/Auditschreibfreiheit
der Vorschau und betätigt zusätzlich `[data-manager-people]` mit Rückfokus.

Die volle Suite bleibt beim Orchestrator. Die Steuerung fährt `index.html`,
`depot-tranchen-manager.html`, `Suite frame profile context` und betroffene
Manager-Guard-/Recoveryfälle, alle vorgesehenen Grundbedienungen sowie den
Bildvergleich 01–03/09 bei 1920/2560 px außerhalb der Sandbox. Die bekannten
P4f-Befunde „Sweep-Werkzeug“ und „95%-KI“ bleiben separat; das Windowsgate wird
unter Linux nicht ausgeführt. Ganze-Euro-Anzeige und weitere Feld-/Depotkorrekturen
sind in Slice 2 umgesetzt und gezielt abgesichert; externe Abnahme bleibt offen. Node-/Quellprüfungen sind keine Browser- oder Bildabnahme.

### Paket 5b, Slice 2: Feld-, Depot- und Startstatusgegenproben

Die fokussierten Manager-/Startkurstests prüfen Bruchbeträge mit unabhängigem
Summen-/Prozentorakel, Centpreise, unveränderte Rohbytes und exakte Cashnachweise.
Schaltergegenproben messen ein vorhandenes Ereignis, keine Writes bei Darstellung,
Sperren, Fehlflush, Rückschreiben, bestätigten Retry und Personenwechsel. Der
Startstatus prüft Erfolg ohne Liste, ausschließlich betroffene Fehlerzeilen,
verständliche Gründe, eindeutige Originalrecordzuordnung, lokale Tagesgrenze und
Sommer-/Winterzeit; Session-/Backendbytes und Requestzahl bleiben getrennte Orakel.

`runIndexSmoke` prüft kompakte Erfolgs-/Teilzusammenfassung, gespeichertes lokales
Fehlkursdatum, Sonderzeichen, Managerlink, bytegleichen Reload und Requestschutz.
`assertManagerRenteOrigin` prüft gesperrte Ableitung, kompakten sichtbaren Hinweis,
volle assistive Herkunft und die per Tastatur geöffnete Infohilfe.
`runTranchesSmoke` bedient die drei Schalter, misst echte Komma-/Punkttastatureingabe
in `#profileGoldZiel` und Rückfokus für Depotkauf/-verkauf und Feldkartenmenü.
Kennzahl-, Gewinn-, Flächen- und Datumsorakel folgen der angeforderten Anzeige;
Cashbestätigung und Audit behalten centgenaue Orakel. Die volle Suite verbleibt
beim Orchestrator; Browser/WebView, Grundbedienung, Bilder und EXE bei der Steuerung.

### Paket 6c, Slice 1: Planungsbeginn und kompakte Ausgabenhinweise

`overview-model.test.mjs` prüft alle zwölf Monate des ersten Planungsjahrs und
denselben bytegleichen Bestand beim ersten Januarabschluss. Alle Belegarten
(Metadaten, ausgewählte Ausgaben einschließlich Nullimport, validierter
Vermögensverlauf, passende Summary) und alle ausgewählten Personen können das
Minimum liefern. Leere Container, fremde Profile/Scopes, ungültige Monate und
beschädigte Belege zählen nicht. Ohne Belege gilt das injizierte laufende Jahr.
Altbestand 2024/2025, unmarkierter Jahresstand, Widerspruch, Pending/Recovery,
fehlende Fach-/Profildaten und gemischter Haushalt haben Gegenproben. Der
reguläre Folgeabschluss am 05.01.2027 bleibt bei `ready`, `ready`/`ready` und
`ready`/`already_committed` trotz beschädigtem Summarycontainer, Ausgabenstore
oder Ausgabenrecord aus 2022 offen und ohne `annualReason`. Quellenfehler bleiben
im Modell erkennbar und verhindern weiterhin die erste Legacy-Ausnahme. Der
Balance-Preflight verlangt weiterhin die Legacy-Bestätigung. Vor Beginn gibt
es weder fehlende Ausgabenrecords noch einen erfundenen Importhaken; innerhalb
des Startjahrs bleiben Lücken erhalten. Genaue Personenmonate bleiben prüfbar.

`overview-ui.test.mjs` prüft den echten Renderer: gemeinsamer Oktober–Dezember-
Bereich, betroffene Dezemberperson, verschiedene/zerstückelte Mengen, viele
Personen, sichere Namensausgabe und den ersten relevanten Importmonat. Der
planfremde Vormonat erhält eine Erklärung; erster Abschluss und Altbestand
haben getrennte Texte/Chips. Kopfpillen, zwölf Monate und vier Kennzahlen,
Budgetherkunft und fehlender Vermögensvergleich behalten ihre Gegenproben.

Gezielt: `node tests/run-single.mjs tests/overview-model.test.mjs`,
`node tests/run-single.mjs tests/overview-ui.test.mjs`,
`node tests/run-single.mjs tests/overview-storage.test.mjs`,
`node tests/run-single.mjs tests/funktionsinventar.test.mjs`,
`node scripts/generate-funktionsinventar.mjs --check` und
`node --check tests/browser-smoke.test.mjs`.
Der vorhandene Browserfall `index.html` enthält die Anpassungen in
`runIndexSmoke`/`runOverviewPresentation`: belegte Jahresnavigation behält ihre
Byteerhalt- und Bedienorakel; Januar des ersten Jahres und erster Rückblick
nutzen denselben synthetischen Bestand ohne Metadaten. Keine neue Registrierung.
Die volle Suite fährt der Orchestrator, Browser/WebView und EXE die Steuerung
außerhalb der Sandbox; Node-/Quellprüfungen belegen diese externen Gates nicht.

## Startkurse – zwei Runden und gemeinsames Zeitbudget (Paket 6c, Slice 2)

`tranchen-startup-prices.test.mjs` misst mit kontrollierter Uhr neun direkte
1000-ms-Gruppen in 3000 ms, höchstens drei gleichzeitige Requests und genau einen
bestätigten Erfolgsflush. Die zweite Matrix prüft die Barriere vor Suchrequests,
Fehlschläge als einzige Fallbackkandidaten und den Cache auch für fehlgeschlagene
Tickerquotes. Der Symboltest verwendet den echten Resolver und Writer für aktive
und inaktive Such-/ISIN-Tranchen und liest deren bestätigte Backend-/Registrybytes
neu ein: nur aufgelöste ticker-Symbole und ein noch nie aufgelöster Originalticker
werden im folgenden Startlauf direkt quotiert.

Die zusätzliche Neun-Gruppen-Probe kombiniert acht direkte 1000-ms-Erfolge
mit einem 404 und hängenden Such-/ISINpfaden: aktive und inaktive Tranchen liefern
`updated = 16`, genau einen Commit und bestätigten Erfolgsflush bei 14000 ms.
Unbeantwortete, späte Header- und späte Bodyvarianten prüfen unveränderte
Endberichte, Cache-/Backendbytes, Requests und Progress nach lokalem Schluss.
Die Uhr protokolliert Commitstart sowie sämtliche Cache-/Backendwrites des
sofort bestätigenden Adapters vor 15000 ms; Timer und Abbruchlistener werden
aufgeräumt. Direkte Erfolge bei 14000/14500/14999 ms starten keinen Fallback mehr.

Ohne direkte Erfolge wird Gruppe A per echtem Resolver und Writer aktiv und
inaktiv erfolgreich, während Gruppe B hängt. Erste Fallbackerfolge bei
2000/14000/14500/14999 ms aktivieren die Reserve dynamisch und liefern zwei
bestätigte Tranchen in einem rechtzeitigen Commit/Flush. Nur offene oder nicht
begonnene Auflösungen erhalten `STARTUP_FALLBACK_TIMEOUT`; fertige Fachfehler
bleiben erhalten. Ohne irgendeinen Kandidaten bleibt das Budget bis 15000 ms
verfügbar, ohne Commit/Write und mit `STARTUP_TIMEOUT`. Nachlaufende Antworten
und Reservetimer erzeugen keine zweite Bestätigung. Ein bei lokalem Schluss
begonnener verzögerter Flush bleibt über die globale Frist hinaus geschützt,
auch bei Fehlflush und kompensierendem Rückschreiben.

Echter Renderer und lesender Binder prüfen eigene Provider-Timeout-, Ausfall-
und Ratelimitgründe, lokale gegenüber globaler Frist, neutrale Teilfehler,
Antwortzeitüberschreitung ohne Nichterreichbarkeitsbehauptung und reine
Proxyausfälle. Namen und Sonderzeichen bleiben Text; gespeichertes Kursdatum,
Managerlink/Handoff, Technikklappe sowie Sitzungs- und Speicherbytes bleiben
erhalten. `runIndexSmoke()` übernimmt die korrigierten Erststart-/Reloadtexte
und prüft kontrollierte Fehlerberichte im echten DOM samt echtem Sitzungsreload.
Der Browserlauf bleibt ein externes Gate der gesteuerten Sitzung.

Grenzen 14999/15000/15001 ms, begrenzte Requesttimeouts, unpassender Rückoff,
verspätete Headers/JSON und Abort ignorierende Antworten sichern keinen
Commitstart nach Ablauf und keine späteren Writes/Progress. Bei Timeout ohne
vorher begonnenen Commit sind Backend-/Cachebytes gleich und updated=0. Ein
rechtzeitig begonnener verzögerter Flush bleibt bis Bestätigung oder Kompensation
geschützt. Anfragedauer ist flüchtige Diagnose in Technik; Quote-, Session- und
Exportfelder sowie Fehlkursliste/Handoff bleiben erhalten. Manuelle Resolver-
und Abbruchendeverträge prüfen Preisservice und Managergegenproben.

Gezielte Ausführung: `node tests/run-single.mjs tests/<name>.test.mjs` für
`tranchen-startup-prices`, `tranchen-price-service`, `tranchen-manager-page`,
`tranchen-manager-navigation`, `profile-storage`, `tauri-csp` und
`funktionsinventar`; Dokumentation mit `npm run docs:evidence`.
Volles `npm test` führt ausschließlich der Orchestrator aus.

Der native Rustdispatcher startet ohne feste Handlerobergrenze einen eigenen
Thread je angenommener Anfrage und wartet nicht auf andere Handlerabschlüsse.
Die drei parallelen Instrumentgruppen im JS-Startlauf bleiben davon getrennt.
Die Vier-plus-eins-Probe blockiert vier Handler mit einer kontrollierten Freigabe,
bietet erst nach deren Eintritt das fünfte Item an und beobachtet dessen Eintritt
vor jeder Freigabe. Dieselbe Probe muss im sequentiellen Kontrollmodell scheitern.
Beide Modelle geben beim Aufräumen alle Handler frei, schließen den Input und
warten mit begrenzten Kanalempfängen auf alle fünf Abschlussmeldungen sowie das
Dispatcherende. Gesamtdauer und Quellanker allein sind kein Parallelitätsnachweis.

Der gezielte externe Offline-Lauf lautet:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --offline --locked yahoo_proxy_ -- --nocapture
```

Dieser Filter muss mindestens diese drei Tests erfassen und erfolgreich ausführen:

- `yahoo_proxy_dispatcher_overlaps_handlers_and_rejects_sequential_control`
- `yahoo_proxy_cors_query_and_errors_keep_contract`
- `yahoo_proxy_routes_preflight_and_errors_use_parallel_dispatcher`

Exitcode 0 mit null Tests erfüllt die Abnahme ausdrücklich nicht. Die lokale
Routenprobe wartet tatsächliche Antworten für Quote-/Such-/Chartparameterfehler,
unbekannte Route, OPTIONS 204 sowie erlaubte und abgewiesene Ursprünge ab und
prüft die bisherigen CORS-/Fehlerfelder ohne Yahoozugriff. Weitere Rusttests
prüfen bestehende Quoteverträge. Die Quellprüfung in `tauri-csp` ersetzt diesen
Lauf nicht. Mangels Rust-Toolchain ist er in der Agentensandbox offen.
Der vorhandene Browserfall runIndexSmoke
behält seine Assertions und ergänzt Technikdauer, sichere Texte und unbekannte
Dauer nach bytegleichem Sessionreload. Browser- und Kandidaten-EXE-Ausführung
bleiben bis zur tatsächlichen externen Prüfung offen.

Paket 4f, Slice 1: `overview-month-close.test.mjs` prüft beide delegierten
Monatsknöpfe mit dem echten `storeMonthProvision()` und ausschließlich lokalem
Testspeicher: Bestätigungsabbruch, blockierter Flush, Re-Render, Doppelklick,
Fehlflush/Retry, Profil-/Scopewechsel und unveränderte Balancebytes. Es bleiben
keine Globals, Singletonmocks, Timer oder Jobs zurück. `overview-ui.test.mjs`
prüft die Beschriftungen und Schritt 3 einschließlich vollständiger Nullausgaben.
`simulator-workshop-ui.test.mjs` prüft Hauptreiteraktivierung, Tastatur,
Rückfokus und die drei direkten Geschwisterhosts mit unverborgenen Ahnen.

Der Browser-Smoke prüft die Werkstattwahl separat im Bildschirm vor/nach Druck
und im Druck alle drei Inhalte unabhängig von der Wahl. Die Monatsmatrix nutzt
beide Knöpfe, Rückfrageabbruch und einen blockierten Flush samt bytegleichem
Reload. `Simulator Monte-Carlo E2E` fordert nach echtem Lauf ein sichtbares
„95-%-Konfidenzintervall“. Diese Browserprüfungen und die Bildabnahme fährt die
Steuerung; die volle `npm test`-Suite fährt ausschließlich der Orchestrator.

### Balance-/Simulator-Feinschliff (Paket 4f, Slice 2)

`balance-renderer-action.test.mjs` schützt einzelne Boxköpfe mit assistiven Captions, Profilspalte, aktuellen Plan-/Haushalts-/Marktdatenkontext, optionale Engineendnotiz und centgenaue Kopie. `designsystem-balance.test.mjs` verwendet den echten Dynamic-Flex-Abgleich für presetgleiche und abweichende Customwerte sowie gesperrte und ausgeschaltete Controls; ein Customklick öffnet und fokussiert einmal nach dem Abgleich, ohne Detailwerte zu schreiben. `simulator-assumptions-ui.test.mjs` prüft am echten Markup leere Klappen, Freigabe/Wiederzeigen und Werterhalt sowie mit echtem Feldbesitzer die unveränderten Sperrgründe außerhalb des Labels ohne unterbrochene Input-/Slidernachbarschaft. `designsystem-components.test.mjs` enthält wirksame Quellmutationen gegen Checkboxüberlagerung, verlorenes Kennzahl-Subgrid, vertikalen Resetblock, Titelstrich, Rollenumbruch, abweichendes Marktgrün und ausgeblendete assistive Caption. Die bestehenden Fach-/Sperr-/Persistenz- und Chartdigests bleiben erhalten.

Der Browser-Smoke ergänzt Balance-Customfokus und Dialogköpfe, native Sliderklicks/Space mit genau einem change je Aktion, Sperren und Protokollspeicherweg, Rollen-/Segment-/Reserve-/Resetgeometrie sowie fluchtende Kennzahlwerte und volle Portfoliohostbreite bei 1920/2560 px. Kleinere Breiten und Druck bleiben Gegenproben. Diese Browserprüfungen und Bildabnahme laufen außerhalb der Implementierer-Sandbox; die volle `npm test`-Suite führt der Orchestrator aus.


### p4h, Slice 1: MC- und Protokolldarstellung

Gezielte Tests prüfen die ruinlastige Histogrammachse aus positiven P97,5 mit
mindestens 1.000 €, vollständige Fall-/Prozentzählung, erfolgreiche Nullwerte,
echten Rest, maximal endliche Werte und unveränderte Satzquantile/Exportprojektion.
`results-renderers` prüft die Referenzzeile ausschließlich innerhalb „Weitere
Kennzahlen“. Szenario-Tests erhalten Quellidentitäten, Jahresend-Realbasis,
Terminalpunkte, vollständige Downloads und Listener-Cleanup; zusätzliche Orakel
prüfen Linienfarben, Ruinjahr, 15 gleichwertige Stichprobenzeilen und deutsche Y-Kurzwerte ohne Cent.

Der bestehende Browserfall `Simulator.html` registriert ergänzend reale
Sichtbarkeitsprüfungen der geschlossenen/geöffneten Kennzahlenklappe bei
1920/640/320 px sowie Szenariografik, 2:1-Aufteilung, 470 px Höhe, Listbox,
Linienfarbe und lokale Scrollflächen bei 1920/2560/640/320 px.
Diese Registrierung ist kein ausgeführter Browsernachweis. Browser-, Bild-,
Druck- und WebView-Abnahme bleiben bei der Steuerung offen; die volle Suite
führt der Orchestrator außerhalb der Implementierer-Sandbox aus.
Das separate win32/x64/Node-v25.2.1-Charakterisierungsgate bleibt unverändert.

`overview-month-confirmation.test.mjs` prüft den schreibfreien DOM-Dialog samt
ARIA, Tastatur, einmaliger Entscheidung und Listener-/Abortlistenercleanup mit
einem dokumentlokalen Doppel. Technische Ablehnung (werfendes/fehlendes
`showModal()`, Elementerzeugungsfehler vor und nach Erzeugung des Dialogknotens)
ist getrennt von regulärem `false`-Abbruch geprüft, samt Rückfokus und erneuter
Öffnung auf demselben Dokument. `overview-month-close.test.mjs` bindet für die
Fehler-, Abbrechen-, Escape- und Bestätigungsfälle den echten Helfer ohne
`confirm`-Ersatz. Geprüft werden der festgelegte Dialogfehlerstatus nach Refresh,
kein Storeauftrag, vollständige bytegleiche Speicherwerte, offener Monatsanlass,
zwei aktive neu gerenderte Knöpfe und Rückfokus. Die bisherige Matrix sichert
weiterhin Sperren während Nachfrage und Flush sowie Profil-/Scope-/Monatswechsel.
Der registrierte `index.html`-Browserfall simuliert beide `showModal()`-Fehler und
stellt den ursprünglichen Prototype-Descriptor in `finally` vollständig wieder
her. Er prüft sichtbaren Status, Schreibfreiheit, aktive Knöpfe, Rückfokus,
Refresh und normale Wiederöffnung; Abbrechen/Escape starten danach mit leerem
Status. Tab/Shift+Tab, blockierter Flush und Reload bleiben enthalten.
Diese Registrierung ist kein ausgeführter Browsernachweis. `npm run test:browser`
und die tatsächliche Browser-/WebView-Abnahme führt die Steuerung außerhalb der
Implementierer-Sandbox aus; die volle Suite führt der Orchestrator aus.

Die vorhandene Werkstatt-Druckmatrix unterscheidet leere Hosts von tatsächlich
vorhandenen Ausgaben und prüft Replay passend zur Bildschirmwahl. Die MC-Browserprobe
publiziert Szenario B vor dem regulären Ergebnisbinden und prüft beide Exportfehler
ohne Download. Vollständige JSON-/CSV-Orakel, Leerbatch-/Rebindcleanup und aktuelle
Replayquelle bleiben in `scenario-log-view.test.mjs` erhalten. Browser-/WebView-,
Bild- und Druckabnahme erfolgt außerhalb der Agentensandbox; die volle Suite fährt
der Orchestrator auf dem zur Abnahme vorliegenden Stand.

### Paket 10, Slice 4: zentrale Personenpflege und getrennte Abschlussgates

`designsystem-start-handbook.test.mjs` prüft den erreichbaren Handbuchanker
`profilverbund-personendaten`, Erstumstellung/Abbruch, die Januarregel, festen
Altalter-Fallback, Jahresrentenrechnung ohne Monatskürzung, vollständigen
Migrations-Restore und die tatsächlichen Namen des Simulatoränderungslinks und
Abweichungsschalters. Der technische Schlüsselabgleich verwendet
`PERSON_VALUE_KEYS`; die dokumentierten CSV-Zusätze werden gegen
`personDataCsvFields()` geprüft. Entfernte Alterswrites und Rentenpersistenz
werden nicht mehr zugesagt. Kapitel, Altanker, sechs SVGs und bestehende
Recovery-/TOC-Orakel bleiben erhalten.
Für H06 prüft eine eigene Assertion in `#simulator-szenario-log` die
Finanzannahmen samt Personenbeleg des abgeschlossenen Laufs und die
JSON-/CSV-Downloads.

`funktionsinventar.test.mjs` prüft den neuen Kapitelanker samt Ausgangszustand,
konkrete Inhaltsnachweise für H05/H06/H07/H09 sowie additive
Export-/Altspaltenbelege bei S31/S55. Die referenzierten Kapitelassertions werden
isoliert ausgeführt; jeder P10-Node-Bezug muss tatsächlich einen eigenen
Kapitelselektor lesen. Gegenproben erkennen falsche oder entfernte Assertions
und einen geänderten H06-Lauftext. Der extern offene zentrale TOC-/Fokusbezug
gehört nur zu H09; H05/H06/H07 führen fehlende kapitelbezogene Browsernachweise
als Lücke. Ein Browserbezug auf einen fremden Anker wird abgewiesen. Die 162
historischen Kennungen, Anker-/Erzeuger-/Funktions-/Delegationsgates,
Quellmutationen und Schutzkategorien bleiben erhalten. Markdown wird nur mit
`node scripts/generate-funktionsinventar.mjs` erzeugt, Aktualität danach mit
`node scripts/generate-funktionsinventar.mjs --check` geprüft.

Gezielte Befehle: `node tests/run-single.mjs tests/<name>.test.mjs` für
`designsystem-start-handbook`, `funktionsinventar`, `profile-person-data`,
`profile-person-migration`, `balance-annual-person-data`,
`balance-person-data-readonly`, `tranchen-manager-person-cards`,
`simulator-person-overrides`, `simulator-run-assumptions`,
`simulator-monte-carlo`, `scenario-log-view`, `monte-carlo-export-contract`,
`historical-backtest-export`, `stress-replay-export`,
`protocol-export-completeness` und `svg-images`. Diese Fachtests sichern
Snapshot-/Transaktionsreadback, Abbruch/Rollback, Quellen-/Einheitengrenzen,
Alterswritefreiheit, Backend-/Schreibrekorder, numerische Rechengrenze,
Laufbindung, vollständige Exporte und lesbare Altdateien. Zusätzlich laufen
`npm run docs:evidence` und `node --check tests/browser-smoke.test.mjs`.
Keine Snapshot-, Finanz-, Engine- oder Plattformbaseline wird neu festgesetzt.

Der vorhandene Browserfall „Personendaten Karten 01–04/07“ umfasst auch 05/06:
zentral bestätigte Rente/Kirchensteuer/SPB in beiden Verbrauchern, gesperrten
Normalmodus, echten MC-Lauf, Ergebnis-/Protokoll-/JSON-/vollständigen CSV-Beleg,
unveränderten fertigen Download nach neuer Alternative, zentralen Handoff und
Ausschalten/Reset/Reload. Die Personenbytes werden nach Facadeflush direkt aus
IndexedDB neu gelesen; Profilpersonen und entfernte Simulatorpersonenkeys sind
von erlaubten Modellkeyänderungen beim Reset getrennt. „Person data migration“
bedient Quellenkonflikt, Fokusumlauf, Escape, kontrollierten Retry, gesicherte
Umstellung und Datumsnachtrag. „Handbuch.html“ bedient zusätzlich das neue
TOC-Ziel mit Hash/Fokus und prüft die sichtbaren Kernaussagen.

Diese Registrierungen sind keine ausgeführte Browserabnahme. Die Steuerung
bestätigt separat alle zehn Bedienabläufe aus Slice 4, einschließlich
Jahresabschluss/Retry und tatsächlichem Recovery-Restore, mit Ziel 10/10;
Fehlbedienungen gehen als Befund zurück. Der Bildvergleich aller Zustände 01–07
bei 1366/1920/2560 px verwendet dieselben synthetischen Werte, Schrift, Zoom
und passenden Kartenstände. Schmale Breite und lange Namen bleiben Gegenproben.
Windows-Kandidaten-EXE, WebView und das win32/x64/Node-v25.2.1-
Charakterisierungsgate sind getrennte Nachweise. Bis tatsächlicher Ausführung
bleiben diese Gates offen; `listen EPERM` in der Sandbox ersetzt sie nicht.
Die volle `npm test`-Suite führt allein der Orchestrator außerhalb der Sandbox
auf dem zur Prüfung vorliegenden Stand aus. Implementierer geben ihre Arbeit
nicht selbst frei.

### P8e – Gesamtfläche bei Ausschnitt und Originaltagesanzeige

Bei `floor === 0` bleiben Anlageflächen und Gesamtlinie erhalten; bei positivem
Achsenfuß gibt es ausschließlich eine ruhige Gesamtfläche je bekanntem Lauf.
Die Ausschnittlegende nennt den letzten Originaltag („Stand“), dessen tatsächliche
Anlagebeträge in Aufteilungsbalkenfarben und „Gesamtwert“ als Linie. Unbekannte
Teilbeträge werden nicht durch ältere Beträge oder Null ersetzt. Das Tickraster
teilt die unveränderte Skalenbasis gleichmäßig, einschließlich beider Grenzen,
mit mindestens drei Intervallen. Fehlt ein geeigneter ganzzahliger Teiler
(etwa bei 11, 13, 17 oder 19 Basisintervallen), wird die Spanne geviertelt;
zusätzliche Dezimalstellen erhalten die tatsächlichen Tickbeträge.

Zeiger wählen über Tagesmitten den nächstgelegenen Originaltag, bei Gleichstand
den früheren. Ohne Auswahl wählt der erste Pfeil den letzten Tag; weitere Pfeile
gehen genau einen Originaltag weiter, auch über unbekannte Tage und Wochenenden.
Esc schließt bei erhaltenem Fokus. Zeigerverlassen schließt nur Zeigerauswahl,
Fokusverlust jede Auswahl. Die zuletzt verwendete Eingabe bestimmt die Auswahlquelle:
Zeigerbewegung nach einer Pfeiltaste leert auch auf demselben Tag den Tastaturstatus.
Resize einer Zeigerauswahl oder nach Zeigerverlassen bleibt ohne Statusansage.
Resize erhält Datum und Grafikfokus; außerhalb eines
neuen Zeitraums schließt die Anzeige. Alles bleibt flüchtig und hostlokal.

Gezielte Nachweise mit `node tests/run-single.mjs tests/<name>.test.mjs`:

- `tranchen-history-svg`: feste Skalenorakel, gleichmäßige numerische/geometrische
  mindestens vier präzise beschriftete Ticks je Skalenfall, Primzahlfälle
  11/13/17/19, größere Basisintervalle mit Ausdünnung, achsenabhängige Flächen je Lauf,
  offene deckungsgleiche Konturen, Extrema, Lücken und Pflichtpunkte.
- `tranchen-history-hover`: reine Tagesauswahl und echte Ereignisbindung im
  DOM-/SVG-Geometriemock; tatsächlich ungezeichneter Aufteilungstag, Cashsprung,
  Wochenende, Null/Unbekannt, Grenzen, Tastaturstatus, Esc/Blur, Replace,
  beide Reihenfolgen von Zeiger-/Tastaturwechsel inklusive gleichem Tag und
  leerem Status nach Resize, Resizefokus, mehrere Charts, Listener-/Framecleanup
  und unveränderte Eingänge.
- `overview-ui`: gemischte Aktien/Geldmarkt/Cash/Gold/Anleihen-Endtagslegende,
  unbekannter Endbetrag, Balkenfarben und bestehende Kennzahlen-/Größenbindung.
- `tranchen-history-ui`: Einzelpersonen-/Haushaltsprojektionen am gemeinsamen
  Renderer; Manager-Sparklines und Kursdetails erhalten ihre bisherigen Verträge.
- Regressionen: `overview-model`, `tranchen-history-model`,
  `wealth-history-render-performance` und `funktionsinventar`.

Das bestehende Browsergerüst unter `index.html` ergänzt
`runOverviewHistoryDayInteraction`: echte synthetische Modellquelle um 212.000 €
bei Achsenfuß 100.000 €, gemischte Anlagen, ein nachweislich ungezeichneter
Wochenendtag gegen Originalwerte, Pfeile/Esc, beide Eingabereihenfolgen mit
Zeigerverlassen und stummem Resize, sichtbarer Fokus und Tagesfelder
an beiden Rändern bei 1366/1920/2560 CSS-Pixeln. Es prüft Texte/Gesamtlinie,
Schraffur, Überlauf, Modell-/Profil-/Kursbytes, Kennzahlen und Schreib-/Abrufzähler.
Die Produktbasis ist derzeit hell; Dunkel wird im Gerüst als lokale Prüffarbpalette
injiziert, ohne einen neuen Produktmodus einzuführen. Die seitenweite Ersetzung
nativer Dialoge bleibt erhalten. `high/1366/12m` bleibt als lange Zickzackfixture.
Dekodierte Tagespunkte und lineare 25/50/75-Prozent-Zwischenstellen behalten ihre
Grenze von 0,05 px; `getPointAtLength` hat einen eigenen Zähler und 0,25-px-Grenze:
Messfehler wächst mit Pfadlänge, 0,25 px bleibt unsichtbar.

Inventarlesefassung ausschließlich mit `node scripts/generate-funktionsinventar.mjs`
erzeugen und mit `--check` prüfen. Im orchestrierten Lauf führt ausschließlich
der Orchestrator die volle `npm test`-Suite außerhalb der Sandbox aus;
Implementierer fahren gezielte Läufe. Ein durch Sandbox-Unterprozesssperren
unvollständiger Lauf gilt nicht als grün. Das win32/x64/Node-v25.2.1-Charakterisierungsgate bleibt
separat; Runner und Baselines werden nicht angepasst.

Browser- und Bildabnahme bleiben bis zur tatsächlichen externen Ausführung offen:
`node tests/browser-smoke.test.mjs --only=index.html`, Grundbedienung Ziel 10/10
mit separat ausgewiesenem bekanntem Fall „Suite frame profile context“, Bilder
für Startseite und Personen & Vermögen bei allen drei Breiten Hell/Dunkel sowie
Hoverbild. Ein Node- oder Quellnachweis ersetzt diese Abnahme nicht.


### P16, Slice 3: Kernantworten und Abschlussinventar

`results-metrics.test.mjs` prüft feste 96-%-/12-%-der-Jahre-/18-%-Orakel auf `cutYearSharePct.p50`, echte Nullkürzung,
vollständigen Todpfad, Zeitraumende, Technikfehler, Legacy und fehlende/nicht endliche Werte.
`results-renderers.test.mjs` prüft beide Fragezeilen, große Werte, Textmaskierung und
Veraltetstatus. `simulator-result-overview.test.mjs` sichert Zahlen-/Laufbelegerhalt bei
Darstellungs-/Annahmenwechsel, Abbruch/Spätantwort und den gemeinsamen Folgeabschluss.
`designsystem-simulator-results.test.mjs` schützt den echten Host vor Kennzahlen und
responsives, ungekürztes Markup; die bestehenden Viewmodel-Digests bleiben unverändert.
`designsystem-start-handbook.test.mjs` prüft die tatsächlichen Ergebnis-/Protokollkapitel.
`funktionsinventar.test.mjs` prüft Erzeuger, Anker, konkrete Testbelege, historische Kennungen
und bestehende Schema-/Größen-/Lesbarkeitsgrenzen; Lesefassung ausschließlich mit
`node scripts/generate-funktionsinventar.mjs`, anschließend `--check`.

Gezielte Läufe: `node tests/run-single.mjs tests/<name>.test.mjs` für die sechs obigen Tests
und `simulator-run-assumptions`; zusätzlich `node --check tests/browser-smoke.test.mjs`
und `npm run docs:evidence`. Die volle abschließende `npm test`-Suite fährt der Orchestrator
außerhalb der Sandbox auf demselben fertigen Stand. Das gepinnte
`tests/simulator-backtest-characterization.test.mjs` wird unter Linux nicht separat ausgeführt;
Baseline und Runnerpolicy bleiben gleich. Sandboxverbote für Browser, Ports oder Kindprozesse
sind kein Produktfehler und kein grüner Nachweis.

Registrierte, noch nicht ausgeführte Browsernachweise: „Simulator Kernantworten“ prüft die
synthetische Antwortmatrix bei 1920/2560/640/320 px mit echten Renderern und Überlaufmessung.
„Simulator Kopfaktion“ ergänzt echte Runs, Annahmen-/Reiter-/Klappwechsel ohne neuen Abschluss,
gemeinsamen Veraltetstatus und Folgeabschluss. Diese Registrierungen ersetzen keine Abnahme.
Extern offen: Grundbedienung Ziel 10/10, MC-Bilder 1920/2560 und „Simulator · Annahmen“
1366/1920/2560 einschließlich Abweichungsmodus und Partnerfall. Bildabnahme verlangt kein
„abgeschnitten“; `mc-bilder.mjs` bleibt extern ohne Repositoryänderung. Browser-/WebView-/Druck-
und Windows-Plattformabnahme bleiben getrennte Gates.

### Paket D / Slice 1: Kopie-Probelauf

Gezielt über `node tests/run-single.mjs <datei>`:
`app-clock.test.mjs`, `probelauf-runtime.test.mjs`, `probelauf-state.test.mjs` und
`probelauf-ui.test.mjs`. Die Tests prüfen reale Kalenderfälle, Runtimegrenze,
dauerhafte Phasen/Readback, vollständigen Rohrestore mit getrennten Archiven und
LocalStorage-Fallback, Fehler/Neustarts sowie Band-/Dialog-/Guardaktionen mit DOM-
Attrappen. Ergänzende Assertions liegen in Übersicht-, Backtest- und Kursfrischetests.
Die bestehenden `*.test.mjs`-Discoveryregeln finden alle neuen Dateien.
Die vollständige Suite fährt im orchestrierten Lauf nur der Orchestrator;
Browser-/Druck-/Tauri-Abnahme bleibt für diesen Zwischenschritt extern offen.


### Paket D, Slice 2 – Muster-Haushalt und synthetische Kurse

Gezielte Agentenläufe über `node tests/run-single.mjs <datei>` prüfen
`probelauf-prices`, `muster-haushalt`, `probelauf-workflow`, `probelauf-state`,
`probelauf-ui`, `tranchen-history-fetch` und `tranchen-startup-prices`.
Die werfende Netzwerkattrappe belegt lokale Kurswege. Der Workflow verwendet echte
Jahres-/Monats-/Verkaufs-/Cashwriter und dauerhaftes Readback; nichtkursbezogene
Pflichtwerte bzw. bestätigte Balanceeingaben werden injiziert. Byteorakel vergleichen
alle ursprünglichen Rohrecords und alte Archivpunkte; nur Vor Probelauf bleibt neu.
`runProbelaufMuster` ist im Browser-Smoke registriert (sechs Seiten, Kopfzugang ohne Parameter, Quelle, Kalender,
Ende und vollständiger Rückweg). Browser-, Bild-, Druck- und Kandidaten-EXE-Messung
bleiben bis zur externen Ausführung offen. Der Orchestrator fährt `npm test` nach
den letzten Änderungen. Das gepinnte `simulator-backtest-characterization`-Gate wird
auf Linux weder direkt ausgeführt noch auf neue Baselines gebracht.


### Paket D-Folge, Slice 2 – gemeinsamer Seitenstart und Persistenzwettläufe

`node tests/run-single.mjs tests/probelauf-page-start.test.mjs` prüft den echten
`initializeProfilePage()`-Pfad einschließlich Probelauf, Guard/Navigationdialog,
Quellwahl, Personenmigration, Facade, Bootstrap und Bereitschaft. Nur DOM,
Backend-I/O und Tauri-IPC sind Attrappen; Cache und Backend bleiben getrennt.
Freigebbare Promises erzwingen Lock-/Lifecyclekonkurrenz und verzögerte Writes;
Abschlusskontrollen sind begrenzt, Aufräumen erfolgt in `finally`.

Fälle: früher `idle`-/`result`-Wechsel mit Bleiben/Zustimmung, Quellwahl samt
Parallelstart/Reload und Feldsperre bis Readback, Writefehler/Rollback, Tauri-
Restoration ohne Browserfallback, aktiver Start mit verzögertem Read,
Fünfseitenrundgang und +1 Tag ohne Schlafpause, Writerfolge mit/ohne Web Locks
sowie echte Recovery mit sichtbarer Vollsicherungs-/Importsperre ohne Nebenwirkung.
Optional grenzt `PROBELAUF_CASE` auf `navigation`, `migration`, `fields`, `tauri`,
`active`, `roundtrip`, `fallback`, `recovery` oder `recovery-page` ein; ohne diesen
Diagnosefilter läuft die ganze Datei. Keine Runnerpolicy/Baseline wird geändert.

Ergänzende gezielte Tests: `profile-navigation`, `profile-person-migration`,
`probelauf-state`, `probelauf-ui`, `probelauf-workflow`, `probelauf-runtime`,
`navigation-guard`, `navigation-guard-dialog`, `navigation-guard-reload`,
`persistence`, `persistence-write-navigation`, `snapshot-archive` und
`overview-month-close-integration`, jeweils über `tests/run-single.mjs`.
Der Orchestrator führt das abschließende `npm test` außerhalb der Sandbox auf dem
fertigen Stand aus. Browser-Smokedatei bleibt unverändert; Nodebelege ersetzen
keine offene Browser-/BFCache-/WebView-/EXE-Prüfung der Steuerung.


### Jahresstatus und Haushaltsauswahl (Paket 12, Slice 1)

`planning-start.test.mjs` prüft die gemeinsame P6c-Ableitung und die Profilidentität der Abschlussquelle. `overview-model.test.mjs` sichert Haushalt A+B mit genau einem Balance-Stand, Profil-/Registrywechsel, Pending, Quellschaden und Scopewechsel bytegleich ab. `balance-person-data-readonly.test.mjs` führt den produktiven Reader-/Sync-/Updatekörper mit echter Engine für null Auswahl, nur B und A+B aus; geöffnete Identität A und persönliche Steuerwerte bleiben erhalten. Jahresworkflow/-navigation prüfen den erreichbaren Erstjahrhinweis vor Snapshot- und Fachwrites.

Die Legacyprüfungen in `balance-smoke.test.mjs` und `balance-wealth-history.test.mjs` verwenden einen echten Ausgabenbeleg aus 2025, damit ihre bestehenden Dialog-, Fehlerkanal- und Abschlussprüfungen einen fälligen Abschluss erreichen. Der Vermögensvertrag beginnt weiterhin 2026. `profile-person-migration.test.mjs` prüft zusätzlich zur Einzel- und Haushaltsrechnung getrennt den Fallback ohne Auswahl und nur B bei geöffnetem A; abweichende Einkünfte von B sichern die Quellenidentität. Einkommens-, Herkunfts-, Schreibfreiheit- und Reloadprüfungen bleiben erhalten. Der unveränderte Darstellungsvergleich in `designsystem-balance.test.mjs` bleibt mit seinem bisherigen Status-Fixture ausführbar.

Gezielte Ausführung: `node tests/run-single.mjs tests/<name>.test.mjs` für planning-start, overview-model, overview-storage, overview-ui, balance-next-steps, balance-renderer-summary, balance-reader, balance-person-data-readonly, profilverbund-balance, balance-annual-workflow-contract und balance-annual-navigation. Dazu Browserdateisyntax und Inventargate. Die volle Suite läuft ausschließlich beim Orchestrator. Browserfälle „Household annual source“ und „First planning year“ sind zusätzlich registriert; „Suite frame profile context“ bleibt unverändert. Externe Ausführung mit `npm run test:browser`, Bedienung 10/10 und Drehbuch 02.01.2026–02.01.2027 bleibt bis zum ausgeführten Nachweis offen.

### Paket 12: gezielte Regressionen und externe Abnahme

Die gezielten Node-Läufe prüfen Cash-Entnahmen mit fehlender Historie, kalenderbezogene
Migration über 2026–2029 mit echtem Balance-Reader und Simulatoradapter, Aufschub mit
Doppelklick/Lease-Ende sowie Depotdialoge ausschließlich über `#depotAddTrancheBtn` und
`#depotOpenSaleEntryBtn`. Designsystem-Source-Verträge prüfen Zentrierung, Schrifttokens
und die dialoglokale Aktionslücke; sie sind keine ausgeführte Geometriemessung.

`profile-asset-values.test.mjs` sichert den echten Writerverbraucher ab: Bei bekannter
Cashbasis ohne Historie sind Entnahmen und bereinigte Veränderung vorläufig 0;
alle rückwirkenden Punkte kennzeichnen die Basisannahme, Speicherbytes bleiben gleich.
Der gesperrte Einkommensstatus erklärt weiterhin seine Ableitung und unabhängige
sonstige Einkünfte, ohne den Kalenderhinweis des Rentenbeginnfelds zu wiederholen.

Der registrierte Browserfall „Page choice dialog geometry“ misst vier Einstiege bei
1280 und 390 CSS-Pixeln, insbesondere die horizontale Randdifferenz ≤ 3 Pixel im Manager.
„Person data migration“ bedient Jetzt übernehmen, Später und Escape am echten Kopf.
Browserabnahme, Grundbedienung 10/10, der unveränderte Fall „Suite frame profile context“
und Drehbuch 02.01.2026–02.01.2027 für Muster A+B bleiben bis zur externen Durchführung
offen. `npm test` führt ausschließlich der Orchestrator außerhalb der Sandbox auf dem
fertigen Stand aus; das gepinnte Windows-Charakterisierungsgate bleibt unverändert.


### Paket 12c, Slice 2: stabile Belege und dauerhafter Dialogschluss

Gezielt über `node tests/run-single.mjs tests/<name>.test.mjs`: `planning-start`,
`overview-model`, `overview-storage`, `profile-person-migration`, `profile-navigation`,
`page-choice-dialog`, `designsystem-foundation` sowie die Slice-1-Verträge
`balance-annual-navigation` und `balance-annual-workflow-contract`.
Die Rot-/Grünproben belegen getrennt die echte Summary-Schreibfolge, den echten Dialog
an Backendwrite und Readback sowie die fehlende Optionsschrift. Die Migration prüft
Erststart/Aufschub, mehrere Personen/Partner, Zukunftsrente mit Versatz 2, eingefrorene
Auswahl, Feldsperre, Fehler/Rollback und unmittelbaren Backendneustart `current`.
`P12C_MIGRATION_BARRIER=write` bzw. `readback` grenzt nur die neuen Barrieren diagnostisch ein.
Das Designsystemgate prüft Selektoren, Spezifität und echte Ladefolge mit Gegenmutationen;
es ersetzt keine berechnete Browsergeometrie.

Browserdateisyntax: `node --check tests/browser-smoke.test.mjs`; Inventarlesefassung
mit `node scripts/generate-funktionsinventar.mjs`, danach `--check` und
`node tests/run-single.mjs tests/funktionsinventar.test.mjs`.
Registriert, extern offen: „Stabiler Planungsbeginn nach Balanceöffnung“,
„First planning year“, „Künftige Rentenquelle Umstellung“, „Person data migration“
und „Page choice dialog geometry“. Absichtliche Neustarts warten auf das neue bereite
Dokument; Navigationsfehler werden nicht unterdrückt. Normalstart und BFCache-Rückkehr
bleiben getrennt. Der unveränderte Fall „Suite frame profile context“ bleibt bestehen.

Dieser Auftrag verlangt zusätzlich den abschließenden Agentenlauf `npm test` auf dem
fertigen Stand; tatsächliches Ergebnis und Sandbox-Unterprozesssperren stehen im
Slicebericht. Erforderliche externe Wiederholungen bleiben offen. Das gepinnte
Windows-x64-/Node-v25.2.1-Charakterisierungsgate wird unter Linux nicht direkt
aufgerufen; Runnerpolicy und Baselines bleiben unverändert.


## Einkommen heute und Gesamtklappen (Paket 12e)

`tranchen-manager-income.test.mjs` verwendet den produktiven Pfad `projectManagerProfiles` → `renderManagerProfiles`: synthetischer Haushalt am 08.10.2026 mit 2.400 € heute und 3.050 € ab Juli 2028, Beginn am 15., Vor-/Rücksprung, sonstige Einkünfte, Einzel-/Außenprofile, gruppierte kumulierte Stufen, Nullrente, fehlender bestätigter Beginn und beschädigte Herkunft. Byteorakel und vorgerücktes Planungsjahr sichern die Lesegrenze. `profile-person-data.test.mjs` vergleicht die gemeinsame Rentenexportgrenze mit der bisherigen Jahres-/Migrationsprojektion, auch ohne Alter/Schema.

`tranchen-manager-person-cards.test.mjs` belegt getrennt den ersten Gesamtklick bei tatsächlich offenen Regionen und veralteter Erinnerung. Weitere Fälle vergleichen Einzel-/Gesamt-ARIA mit `hidden`, reguläre gemischte Folge, Öffnungs-APIs, Hash, Rerender, A/B/A, Reload, fehlende Region und gesperrten Sitzungsspeicher. Der produktive Geburtstagsergänzungsweg wird in `tranchen-manager-profiles.test.mjs` gegen Gesamttext/ARIA geprüft. Beide Fehler sind vor Produktänderung rot und nach Korrektur grün belegt; Details im Slice-Bericht.

Der registrierte Browserfall „Einkommen heute und Gesamtklappen“ nutzt denselben synthetischen Haushalt, Datumssprünge über die Probelaufuhr, Klick/Enter/Space, Profilwechsel und fokussierbare Hilfe bei drei Zukunftsmonaten. Browser-, Bild- und Bedienabnahme bleiben bis zur externen Ausführung offen. Das gepinnte Backtest-Charakterisierungsgate behält seine bestehende Plattformpolicy; auf Linux wird es nicht ausgeführt.

### Tagesgeld bei bestätigten Abschlüssen

`app/profile/profile-cash-update.js` bereitet ausschließlich `profile_tagesgeld`
und `profile_cash_history_v1` über den bestehenden Profilwriter in privaten
Recordkopien vor. `app/shared/tagesgeld-fields.js` liefert schreibfreie,
namentlich zugeordnete Felder mit dem gemeinsamen Dezimalparser. Monatshaken,
Cashstände und Registry werden in einem begrenzten `replaceRecordsTransactional()`
mit Rohbyte-Vorbedingung und dauerhaftem Readback bestätigt; zuvor entsteht ein
geprüfter Monats-Wiederherstellungspunkt. Die Jahresfinalisierung nimmt dieselben
Cashrecords in die vorhandene Periode-/Verlaufstransaktion auf und behält den
ursprünglichen Jahressnapshot auch bei Retry. Cashnachtrag und Korrektur
bestätigen den absoluten Stand gemeinsam mit dem append-only Audit. Duplikate
setzen neuere Stände nicht zurück. Die bestehende P8-Tagesnettoauswertung bleibt bestehen.

Gezielte Nachweise: `tests/profile-cash-update.test.mjs`,
`tests/tagesgeld-fields.test.mjs`, `tests/overview-month-close-integration.test.mjs`,
`tests/balance-wealth-history.test.mjs`, `tests/tranche-reconciliation.test.mjs`
und `tests/tranchen-manager-navigation.test.mjs`. Die Navigationsprüfung trennt
den schreibfreien Cash-Vorflush von Backendwrite und Backendrollback. Beide
Cashwege sichern Vorflushfehler ohne Write, Readbackabweichungen, sichtbaren
Recoverybedarf, Navigation während Write/Rollback und identische Retries ab.
`tests/tranchen-manager-page.test.mjs` belegt für Bestätigung und Korrektur,
dass ungespeicherte fremde Profilfelder vor jedem Write zur sichtbaren Verweigerung
führen; Eingabe und Dirty-Baseline bleiben erhalten. `tests/overview-model.test.mjs`
prüft A+B mit abweichenden Livewerten und Livehistorie für A sowie ausgeschlossenem
Außenprofil C. Der Monatsintegrationstest verwendet die produktiv projizierten
`cashPeople` ohne Ersatz durch `captureCashPeople` bis zum dauerhaften Backendreadback.
Cache und Backend werden getrennt geprüft. Browserfälle für Monatsstart, Wiederöffnung und Schrittaktivierung,
Abbruch, Escape, zwei Personen, unveränderte Werte und Doppelklick sowie Jahres-
und Cashnachtragfelder liegen in `tests/browser-smoke.test.mjs` und benötigen
externe Ausführung. Das gepinnte Windows-Charakterisierungsgate bleibt unverändert.

### Beispielausgaben im Probelauf (Slice 1)

`probelauf-example-expenses.test.mjs` prüft die echte Koordinatorfreigabe, CSV-
Determinismus, 24 Monate für einen/zwei/vier Teilnehmer, 85–110 Prozent,
Dezember-/Reparaturfaktoren, einmalige Haushaltsbasis, unveränderten Parser,
Bestätigung, Ersetzung, Herkunft, serialisierte Aktionen, verzögerte Text-/Vorschau-
und Flushgrenzen sowie Probelaufende ohne fremde Writes.

`balance-expenses.test.mjs` erhält seine Rechen-/Captureorakel und bestätigt nun
Dateiimports ausdrücklich; eine eigene Einzelkennung bleibt dasselbe Ziel wie in der
Übersicht. `balance-expenses-history.test.mjs` trennt Herkunftsrendering und Metriken.
`overview-ui.test.mjs` prüft die bedingte Knopferzeugung; die zusätzliche Integration in
`overview-month-close-integration.test.mjs` führt den delegierten Beispielbinder mit
echtem Parser, Saver, Backend und Guard aus.

`probelauf-workflow.test.mjs` startet den Musterlauf am 02.11.2026, erledigt die
vorhandene Vorjahresvorbereitung und importiert Oktober/November über den Dienst.
Die Erfolgstexte stammen vom echten Monatsbinder mit `storeMonthProvision`. Ein
Kalendermonatssprung und Neustart führen zum zweiten Abschluss. Januar, Dezember,
weitere Monate und Muster/Kopie passieren denselben Dienst und den bestehenden
Jahreskoordinator; Rückkehrrecords und alte Archivpunkte werden bytegleich geprüft.
Bestätigte synthetische Eingaben ersetzen keine fachlichen Abschlussbedingungen.

Der registrierte Browserfall **Probelauf Beispielausgaben** umfasst Normalbetrieb,
URL allein, Vorschauabbruch, Einzel-/Gesamtimport, Budgetvergleich, Herkunft nach
Reload, Oktober-/Novemberabschluss, +1 Monat, Jahresweg mit Dezember und weiteren
Balance-Monaten, Kopie und bytegleiche Rückkehr. Syntax wird in der Sandbox geprüft.
Tatsächliche Browserausführung, Optik/Fokus und Grundbedienung bleiben ausdrücklich
für die Steuerung offen. Die volle Suite führt der Orchestrator aus; das gepinnte
Backtest-Charakterisierungsgate wird auf Linux weder ausgeführt noch neu gebaselined.


### Monatsdialog, Slice 2: Ergebnis und geschütztes Schließen

Gezielt mit `node tests/run-single.mjs <Pfad>`: `close-dialog`,
`overview-month-confirmation`, `overview-month-close`, `overview-month-close-integration`,
`overview-close-dialog-import`, `overview-expenses-wealth-capture`, `probelauf-workflow`
und `designsystem-start-handbook`, jeweils unter `tests/` mit `.test.mjs`.
Die echte Ergebnisinstanz bleibt nach Backendreadback sichtbar; Fertig ist schreibfrei.
Nodeorakel sichern passende Planbeträge, präzise Cashwerte, ehrliche Ausgaben-/Budgetlücken,
Entwurf/Fokus bei Bleiben, finanziell gleiche Schreibweisen, Retry und Rollback-Recovery.
Produktive Import-/Erfassungsdienste belegen persistente CSV-/Vermögensrecords nach
Cashverwerfen, Wiederöffnung und Backendneustart sowie Abbruch während Dateitextwartung.
Store, Transaktionsgrenzen, Runnerpolicy und Baselines bleiben unverändert.

Browserfälle „index.html“, „Tagesgeld Monatsabschluss“, „Probelauf Beispielausgaben“
und „Abschlussdialog Grundbedienung“ prüfen Ergebnis/Fertig und Verwerfrückfrage.
Der letzte Fall misst echte Geometrie und Fokus bei 390/1366/1920 CSS-Pixeln sowie
Backendbytes. Max/Erika starten am 02.11.2026 ruhig; +1 Monat bestätigt November.
Syntax wird lokal geprüft; Browser-/Bild-/WebViewabnahme bleibt bis zur tatsächlichen
Ausführung der Steuerung offen. Inventarlesefassung wird ausschließlich mit
`node scripts/generate-funktionsinventar.mjs` erzeugt und mit `--check` geprüft.
Der Auftrag verlangt zusätzlich `npm test`: dessen tatsächliches Resultat und etwaige
Sandbox-Unterprozesssperren stehen im Slicebericht; externe Wiederholung bleibt Pflicht.


### P16c, Slice 1: Szenariogeometrie und P95-Achse

`scenario-wealth-chart.test.mjs` prüft native Breite × 470, die unabhängigen
Jahresend-Euro-Orakel (Plot 88–410, Spanne 322), P95 und sämtliche Ersatzstufen,
Auswahl-/Rückwahlvorrang für extreme Vermögens-, Pflege-, Risiko- und Stichprobenpfade
real/nominal mit gültigem, fehlendem und inkompatiblem Fächer. Clipkennungen,
Randmarkennamen/Euro/Quellkennungen, endliche Koordinaten, Messlücken und Terminalregeln
sowie unveränderte Quellobjekte bleiben geschützt. `scenario-log-view.test.mjs`
prüft Paddingabzug, verborgenen Host, Resize ohne Listen-/Exportneuprojektion,
Rebind/Dispose und entfernten Pflegezusatz bei erhaltenen Lebensereignissen.
`designsystem-simulator-results.test.mjs` schützt Listengrenze, Detailraster,
Gruppenmuster, Scrollhinweis und Fokus neben bestehenden CSS-Kaskadengegenproben.
Der Quelltextvertrag für R-01 erlaubt die 760-px-Mindestbreite des Szenario-SVG
nur unter 768 px; Gegenproben erkennen ihre Wiedereinführung ab 768 px.
Die bisherige Mindestbreite des Verteilungsdiagramms bleibt geschützt.

`runScenarioWealthBasisSmoke()` registriert 1366/1920/2560/1200/768/390/320 px:
Host-Inhaltsbreite, Außenhöhe 470 ±5, 2:1 ±0,05, kein innerer Chartüberlauf ab
768 px (einschließlich des schmalen zweispaltigen Layouts bei 1200 px), begrenzte unabhängig scrollende Liste, Protokollabstand höchstens 24 px,
Personendetails/Fachnamen ohne Zeilen-/Kartenüberlauf und native Schriftgrößen
mit höchstens 0,5 px Abweichung. Mehrere Randmarken werden bei 1366/1920/2560/768/390
hell/dunkel auf Überlauf/Kollisionen sowie real/nominal mit/ohne Fächer auf
Auswahlvorrang geprüft. Vier Gruppen und eine Listbox ersetzen Select und Chips.
Browser-Syntaxprüfung ist kein Browsernachweis. Externe Browser-/Bild-/Druckabnahme
bleibt offen; der Orchestrator fährt die volle Suite außerhalb der Sandbox nach. Für diesen Auftrag ist außerdem ein vollständiger Implementiererlauf vorgeschrieben.

### P16c Slice 2: Listbox und einheitliche Auswahl

`scenario-log-view.test.mjs` prüft nominale Stichprobensortierung, Gleichstände,
fehlende Endwerte und mehrere Kennungen derselben Quelle ohne Mutation. Binder-
Ereignisse prüfen Roving-Tabindex, Fokus getrennt von Auswahl, Pfeil/Home/End,
Enter/Leertaste, innere Scrollsichtbarkeit, Gruppenmerker/Leergruppen und begrenzte
Navigation. Kopf/Startjahr/Loganzahl und schmale Zusammenfassung folgen der Auswahl.
Echte Download-Blobs bleiben bytegleich zur vollständigen V2-Projektion nach
Liste/Linie/Navigation, Modus und Detail-/Pflegeschaltern; Resize erhält Rohlogs,
Quellidentitäten und sämtliche Exportprojektionen. Fehler und neue Batches
entfernen alte Downloads/Replayquellen. `mc-result-cockpit.test.mjs` prüft den
Replay-Rückweg in die geöffnete aktuelle Auswahl.
Browserfälle sind registriert, nicht in der Sandbox ausgeführt: echte Tasten,
Klappe bei 768/390/320 px und breite kurze Liste bei 1366/1920/2560 px;
echte MC-Läufe mit Pflege/Ruin, vollständige Downloads, Rebind und Replay.
Heatmap typography, Simulator.html und Designsystem tools bleiben externe Gates,
einschließlich voller nutzbarer Portfolio-Kartenbreite bei 1920 px. Bilder in hell/dunkel
gegen den freigegebenen Entwurf bei 1366/1920/2560/390 px abnehmen. Die volle
Suite wird für diesen Auftrag zusätzlich auf dem fertigen Stand ausgeführt;
Linux überspringt das gepinnte win32/x64/Node-v25.2.1-Backtestgate ohne Baselineänderung.

### Seitendialoge: gezielte und externe Prüfung

`node tests/run-single.mjs tests/simulator-page-dialogs.test.mjs` bedient echte DOM-Knöpfe für Reset, Sweep-Grenzlast und Pareto; kurze injizierte Jobs vermeiden Großrechenläufe. `stress-replay-ui.test.mjs` prüft offene/abgebrochene/bestätigte Entscheidungen, Konkurrenz, Kontextwechsel, fehlendes DOM und Öffnungsfehler vor jedem Write. `page-choice-dialog.test.mjs` schützt den Auswahl-/Speichervertrag; `probelauf-ui.test.mjs` prüft die ausdrücklichen Endbeschriftungen. Bestehende Reset-/Flush-/Retry- und reine Simulatorregressionen bleiben verpflichtend.

Die Sweep-Seitenfixtures laden eigene Modulinstanzen, damit veröffentlichte Ergebnisse und Singleflightzustand nicht in spätere Tests des gemeinsamen Suite-Prozesses gelangen. Sie prüfen den Navigationsschutz vor, während und nach der Rückfrage: Abbrechen, Escape, Signalabbruch, Kontextwechsel und Dialog-/Rechen-/Renderfehler registrieren beim Erstlauf kein Ergebnis; beim Folgelauf bleiben nur das tatsächlich veröffentlichte Alt-Ergebnis und seine Ausführungsdaten, Ranges und Heatmap erhalten. Die bestehende Erstlauf-Abbruchassertion in `simulator-sweep.test.mjs` bleibt unverändert.

`native-page-dialog-scan.test.mjs` tokenisiert alle JS-/MJS-Dateien unter `app/`, einschließlich Templateausdrücken. Direkte, globale, optionale, Alias-, Default- und Destrukturierungsgegenproben verhindern native Browserdialogreferenzen. Vier konkret gebundene injizierte `confirm`-Callbacks bleiben zulässig, globale Aufrufe im selben Modul dagegen nicht.

`browser-smoke.test.mjs` ersetzt keine Seitendialogprüfung durch automatische native Antworten. Die Fälle „Slice 1 page dialogs“, „Slice 2 page dialogs“ und „Slice 3 simulator page dialogs“ bedienen echte Knöpfe/Felder. Neue asynchrone Bedingungen verwenden `waitForPageCondition`. Tranche löschen, Snapshot wiederherstellen und Sweep-Großlast werden bei 1366/1920 geprüft; `BROWSER_SMOKE_SCREENSHOT_DIR=/gewählter/artefaktordner npm run test:browser` schreibt die registrierten Bildfälle außerhalb versionierter Quellen. Browser-, Bild- und Tauri/WebViewabnahme bleiben bis zur externen Ausführung offen. Die volle Suite führt im orchestrierten Lauf ausschließlich der Orchestrator aus.

Paket 14 Slice 1: `data-backup-summary.test.mjs` prüft Vergleichsbasis und
Änderungsarten; `data-page.test.mjs` prüft bestätigte Projektion und echten
Seitenstart auch ohne Profilbestand. `persistence.test.mjs` und
`snapshot-key-policy.test.mjs` prüfen atomare Metadaten und enge Keys.
Der registrierte Browserfall `Daten-Sicherung.html` prüft alle sechs Navigationen,
Profilkontext, Dateiausgabe und Seiteninitialisierung; Ausführung/Bildabnahme
außerhalb der Agentensandbox. Die volle Node-Suite fährt der Orchestrator.


### Paket 14, Slice 2: gemeinsame Wiederherstellung und Aufbewahrung

Gezielt mit `node tests/run-single.mjs tests/<name>.test.mjs`:
`snapshot-archive`, `snapshot-restore`, `snapshot-retention`, `data-restoration`,
`balance-storage`, `balance-storage-contract`, `balance-binder-snapshots`,
`overview-storage`, `persistence-write-navigation`, zusätzlich `persistence` nach
der freigegebenen Umfangserweiterung. Der Persistenztest prüft beim produktiven
Import-Recovery bytegleichen Archivbestand plus genau einen vollständig
zurückgelesenen Punkt „vor Zurückholen“ mit identischem Vollimportumfang.
Die neuen Prüfungen verwenden
nur synthetische Personen und Rohstrings: schreibfreie Vorschau/Abbruch,
Standard-/Vollimport-/Personen-Recovery, vorherige andere Profilauswahl, bytegleiche
Rückkehrumfänge, Readbackfehler, verzögerter Vorflush/Snapshotwrite, Doppelklick,
Quell-/Profil-/Punktwechsel sowie Zielwrite-/Rollback-/Reloadfehler. Formularsperren
bleiben nach unbestätigtem Rollback/Reload erhalten. Aufbewahrung prüft 30 Tage
inklusive Grenze, lokale Monats-/Jahresgrenzen, Profile/Umfänge, stabile
Zeitpunktgleichstände, Dauerpunkte, unbekannte/beschädigte Punkte, benötigte
verschachtelte Recoverybezüge, Probelauf, Idempotenz, Archivänderung und Teilstatus.

`runDataPageSmoke` bedient zusätzlich echte Vorschau, Abbruch, Zurückholen und den
Punkt „vor Zurückholen“ mit Reload und Backendreadback. Registrierung und
Syntaxprüfung ersetzen keine Ausführung: Browser/Bilder fahren extern in der
Steuerung; die volle `npm test`-Suite führt im Lauf nur der Orchestrator aus.

### Paket 14, Slice 3: Kurse und Speicher

Gezielte Gates über `node tests/run-single.mjs tests/<name>.test.mjs`:
`data-prices`, `data-storage`, `persistence-location`, `tranchen-history-fetch`,
`tranchen-startup-prices`, `tranchen-price-service`, `wealth-history-navigation`
und `tauri-csp`. Die neuen Prüfungen betreiben den echten Seitenkoordinator,
Bridgeaufrufe mit injiziertem invoke und unabhängige UTF-8-Byteorakel über
IndexedDB-Leseadapter, echten localStorage-Fallback und echten Tauri-Adapter.
Sie unterscheiden bestätigte/teilweise/offline/unbekannte Kurse, geteilte
Ticker, verkaufte Lots, Feiertagsabdeckung, Abbruch, Kontextwechsel, verspätete
Antworten, Writefehler und unbekannte Speicherteilgrößen.

„Daten Kurse und Speicher“ ist im Browser-Smoke registriert. Der Fall bedient
Prüfen/Nachladen, prüft Offline/Erreichbarkeit und eine erfolgreiche leere
Antwort und registriert Bilder für 01/04 bei 1366/1920/2560 über
`BROWSER_SMOKE_SCREENSHOT_DIR`. Registrierung und Syntaxprüfung sind keine
Browser- oder Bildabnahme. Die Steuerung fährt `npm run test:browser`, die
volle Node-Suite und `cargo test --manifest-path src-tauri/Cargo.toml`; sie
prüft zusätzlich die tatsächliche Ordneröffnung in der Windows-EXE.

P14 Slice 4: `profile-person-file.test.mjs` misst Einzelpersonendateien, Byteerhalt,
ID-/Namenskollisionen, Partnerbereinigung, Kontextwechsel, Doppelklick, Write-/Readback-
und Rollbackfehler sowie Probelaufsperren. `data-exchange.test.mjs` prüft den echten
Balance-Reader-/Enginepfad der Sicherungsseite, gemeinsame Importtransaktion und Legacy-
Ordnerhandles. Die bestehenden Balance-, Profil-, Overview-, Manager- und Probelauf-
prüfungen sichern weiterhin die Fachverträge. `data-page.test.mjs` belegt konkrete
historische Zielverweise und den Handbuchanker. Der Browserfall
„Daten-Sicherung Austausch und alte Verweise“ bedient Knöpfe und Dialoge bei
1366/1920/2560; Registrierung und Syntaxprüfung ersetzen keine externe Ausführung.
Volle Suite, Browser 10/10, Zustandsbildmatrix und Sicherungsdrehbuch bleiben Gates der
Steuerung auf dem finalen SOURCE-Stand. Kein Linux-Einzelstart der Backtestcharakterisierung.

### Kopfzeilenzugang zum Probelauf (H2b)

`probelauf-runtime` prüft http/https/file ohne und mit alten Parametervarianten,
alle Tauri-Kennungen sowie fehlende/werfende Identifier-API und unbekannte Laufzeiten.
`probelauf-ui`, `suite-frame` und `overview-ui` sichern genau einen Kopfknopf je
Seite, sichtbare Statushosts, Band/Recovery, echten Dialogstart und verzögerte sowie
spätere Altanker ab. `designsystem-start-handbook` prüft den Kopfzugang und den
Statushost anstelle der entfernten Inhaltsanker; bestehende Recovery- und
Handbuchprüfungen bleiben erhalten. `probelauf-state` und `probelauf-workflow` prüfen zusätzlich
Musterstart, Neustart und bytegleiche Rückkehr samt Archiv in fremdem Alltags-Tauri;
Import-/Sicherungssperren und negative Rückkehrpunktproben bleiben erhalten.
Gezielte Läufe erfolgen über `node tests/run-single.mjs <datei>`. Die volle Suite
`npm test` fährt ausschließlich der Orchestrator. Browser-Smoke und Abnahme beider
EXE-Laufzeiten bleiben externe Prüfungen der Steuerung; Node ersetzt sie nicht.
Das gepinnte win32/x64/Node-v25.2.1-Backtest-Gate und seine Baseline bleiben unverändert.

### Gemeinsamer Jahresdienst (H4, Slice 1)

Mit `node tests/run-single.mjs tests/<Name>.test.mjs`:

- `annual-coordinator`: Ansichtsjahr J/J+1, unbrauchbare Quellen, Legacyentscheidung, Abbrüche ohne Fehlermeldung (einschließlich Dialog-Cancelcallback), Fehler in Vorflush/Snapshot/Pending/Fachwrite/UI sowie vollständiger Restore und tabgebundener Handkursretry. Barrieren in `snapshot_confirmed`, `writes_started`, `validating` und `finalizing` prüfen Navigation ohne Entscheidungsabfrage, `beforeUnload`, gesperrten Restore und zweiten Abschluss sowie genau einen Fachbatch nach Freigabe.
- `annual-engine-loader`: kein Laden ohne Anlass, gemeinsamer Ladeauftrag, fehlende/inkompatible API und statische Importgrenze.
- `annual-operation-lock`: unabhängige Dienstinstanzen/Seiten, fremde Guards, Doppelklick, Monatswrites, Probelaufübergänge, Freigabe und fehlender atomarer Provider.
- `annual-startpage-balance-golden`: sechs H3-Bestandsarten × zwei Strategien × CAPE 0/25 mit echten Diensten, festen Zeit-/Snapshotquellen und vollständigen bytegleichen Finanzrecords/Engineergebnissen.

`balance-annual-storage` bewahrt zusätzlich das unabhängige eingefrorene Legacy-Orakel;
`balance-annual-preview` verwendet ausschließlich den alten Testhelfer für diese
Charakterisierung. Bestehende Jahres-/Monats-, Probelauf-, Ausgaben- und Verlaufstests
verwenden für produktive Starts gültige H3-Speicherfixtures und atomare Sperrprovider.
`balance-close-coordinator` prüft den echten Protokollklick nach Ergebnisersetzung,
Erfolg und Fehler. Der Browserfall „Probelauf Jahresabschluss ohne Netz“ verlangt einen
freigegebenen `btnJahresUpdateLog` und die tatsächlich sichtbare erneute Protokollöffnung.

Für H4 verlangt die konkrete Paketweisung zusätzlich einen vollständigen `npm test`-
Versuch im Slice; der Orchestrator wiederholt ihn außerhalb der Sandbox. Verbotene
Unterprozess-/Browser-/Portstarts bleiben getrennt von fachlichen Fehlern dokumentiert.
Das gepinnte Simulator-Backtestgate wird auf Linux vom bestehenden Runner übersprungen.
Browser-/Tauri-Abnahme einschließlich zweier echter Seiten folgt in der gesteuerten Sitzung.

### H4, Slice 2 – Jahresdialog auf beiden Seiten

Gezielte Gates: `annual-plan-editor.test.mjs`, `overview-annual-close.test.mjs`, `annual-startpage-balance-golden.test.mjs` sowie die bestehenden Jahres-/Monats-, Vorschau-, Import-, Modell-, UI-, Navigations- und Engine-Lader-Verträge. Die Goldenmatrix führt beide tatsächlichen Seitenbinder mit/ohne denselben Planpatch durch acht Bestandskonstellationen, beide Strategien und CAPE 0/25. Die reine Dienstmatrix bleibt als unabhängige Gegenprobe bestehen. Startseitentests bestätigen Ergebnis C, Abbruchbyteerhalt, exakte Änderungsfelder, Monatsretry und echten Restore mit neuer Dokumentgeneration und einmaliger Wiederaufnahme. Der Handkursfall bestätigt einen geänderten floorBedarf und geänderte Jahresend-Cashwerte, erzwingt incomplete_recovery und prüft beide tatsächlichen Wiederaufnahmebinder: adjusted, exakte Feldpfade, Cashreadback, Januarbetrag aus adopted und kein zweiter Jahreswrite.

Registriert: „H4 Startseite Plananpassung und zwei Seiten“ samt FR-3, gegenseitigem Jahresbesitz und Erhalt des Belegs nach späterer Balancevorschau. Browserprädikate bleiben synchron; asynchrone Quellabfragen verwenden `waitForPageCondition`. Für H4 wird gemäß konkreter Paketweisung zusätzlich ein vollständiger Agentenversuch dokumentiert; der Orchestrator wiederholt die volle Suite außerhalb der Sandbox. Browser-Smoke, Bild-/Tauri-WebViewabnahme und Kandidaten-EXE bleiben bei der gesteuerten Sitzung; Nodebelege ersetzen diese Prüfungen nicht.

### AU1a, Slice 2 – vorbereitete Pflichtdaten und Monatsübergang

Gezielt über `node tests/run-single.mjs tests/<Name>.test.mjs`: `close-dialog`,
`balance-annual-navigation`, `balance-annual-marketdata`, `overview-annual-close`,
`annual-coordinator`, `annual-startpage-balance-golden`, `annual-plan-editor`,
`balance-annual-workflow-contract`, `balance-close-coordinator`,
`balance-month-year-close-integration`, `overview-month-close-integration`,
`overview-month-confirmation`, `overview-close-dialog-import`, `probelauf-prices`
und `funktionsinventar`.
Die DOM-Prüfungen bedienen gültiges/ungültiges Tagesgeld, Handergänzungen,
Bereitschaftssprünge, Fokus am Jahresknopf, zugänglichen Schritt 7 und den Übergang
mit zutreffenden Empfehlungszuständen und ausgeblendetem Vorab-Sicherungshinweis.
Backendbytes, Snapshots und Jahresbeleg bleiben vor Bestätigung und beim Monatsretry
geschützt. Die Workflowprobe liest die gespeicherte Ausgaben-Seitenansicht statt
eines entfernten Balance-Ausgabenfelds.
Die Monatsintegration verwendet die gemeinsame DOM-Fixture ohne Ersatz von Store,
Guard oder Bestätigung. Ihre Rollbackgegenprobe verlangt einen gesperrten Retry
bei Recovery; der Monatsdialog übernimmt dazu nach Busy den aktuellen Modellstand.
Handfelder ergänzen nur fehlende Abrufe, und bereits eingetragene Handwerte bleiben
auch nach einem später erfolgreichen Wiederholungsabruf maßgeblich.
Die Jahres-/Monatsintegration prüft den dauerhaft verborgenen Vorab-Sicherungshinweis
auch nach Refresh. Den erhaltenen Exportbinder löst sie intern aus, um dessen
Busy-, Dateiausgabe-, Beleg- und Recoverygrenzen weiterhin unabhängig von diesem
verborgenen UI-Zugang zu prüfen.

„H4 Startseite Plananpassung und zwei Seiten“ registriert die siebenstufige Folge,
Geometrie/Fokus des Monatskopfs und Dialogbilder bei 390/1366 px.
„Tagesgeld Jahresabschluss“ prüft den phasengültig ausgeblendeten Sicherungszugang
auch nach Backupereignissen. Browser-Syntaxprüfung ist kein Browser- oder Bildnachweis.
Die Steuerung führt `npm run test:browser` und Bild-/WebViewabnahme außerhalb der
Sandbox aus; die volle Node-Suite `npm test` führt ausschließlich der Orchestrator aus.

### Parallelisierung der Jahres-Goldenmatrix

`annual-startpage-balance-golden.test.mjs` und `annual-startpage-balance-golden-2.test.mjs` bis `-8.test.mjs` teilen die acht Bestandsarten in unveränderte Fallgruppen. Die gemeinsame Implementierung liegt in `annual-startpage-balance-golden-fixture.mjs`; jede Bestandsart behält beide Strategien, CAPE 0/25, ohne/mit Planpatch und beide tatsächlichen Seitenbinder. Die unabhängige Dienstmatrix aller sechs ursprünglichen Bestandsarten läuft einmal im ersten Teil. Assertions und Bytevergleiche bleiben unverändert. `runner-contract.test.mjs` prüft Poolüberlappung, gepufferte Ausgabe, seriellen Nachlauf, Erfolg, Fehlassertion, Importfehler, harten Prozessabbruch, separate Gates und identische Summen bei einem/zwei Workern.
