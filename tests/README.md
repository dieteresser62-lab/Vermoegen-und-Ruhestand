# Tests und Prüfwege

`npm test` startet den Node-Runner aus [package.json](../package.json). Er prüft Fachlogik, Datenverträge und die mit Test-DOMs ausführbaren Seitenabläufe. Browser-Smoke, Coverage und Builds haben eigene Befehle.

Zwischenstände müssen manuell bedienbar sein und ihre Daten bewahren. Automatisierte Tests sichern Grundbedienung und Datenpfade; Nutzerbefunde haben Vorrang. Eine vollständige Browsersuite für den fertigen Oberflächenstand und weitere Härtung folgen in ihrer eigenen Phase.

## Befehle

Im Repositorywurzelverzeichnis ausführen. Die Skripte stehen in [package.json](../package.json); ein Einzeltest läuft über den Wrapper, damit seine Assertions gezählt werden.

| Befehl | Zweck |
| --- | --- |
| `npm test` | alle vom Runner entdeckten Node-Testdateien nach Ausführungspolicy prüfen |
| `npm run test:paritaet` | vier Muster-Backtests 2000–2025, Jahresreplay und unabhängige Balancefortsetzung prüfen; JSON-Fälle und Zusammenfassung exportieren |
| `npm run test:paritaet -- --pruefungen` | Collector-, Adapter- und Vergleichsprüfungen, 13 Ausgangsfälle sowie Terminal- und Fortsetzungsgegenproben ausführen |
| `npm run test:paritaet -- --benchmark` | bisherige Jahresmodule mit ausgeschalteter Aufzeichnung in Backtest, MC und Sweep vergleichen; aktive Aufzeichnung zusätzlich im Backtest messen |
| `node tests/run-single.mjs tests/<datei>.test.mjs` | eine gezielte Testdatei ausführen |
| `npm run test:browser` | Playwright-Smoke mit eigenem lokalen HTTP-Server und Chromium |
| `npm run test:coverage` | Node-Suite mit V8-Coverage und anschließenden Dateigrenzen prüfen |
| `npm run docs:pruefen` | aktive Doku, Bildmanifest, PNG-Maße, Dateigrößen und lokale Verweise statisch prüfen |
| `npm run docs:bilder` | 41 App-Bilder mit Playwright und festem Muster-Haushalt erneuern; Doku-Werkzeug außerhalb der Tests |
| `npm run docs:evidence` | Architektur-/Modellbelege mit den Forschungs- und Marktregistern abgleichen |

Gezielte Läufe ersetzen die volle Suite nicht. Im Ergebnisbericht nennen, welche Prüfwege tatsächlich liefen, welche ausgelassen wurden und welche Voraussetzungen fehlten. Ein grüner Node-Lauf belegt keine EXE-Bedienung und keinen Browser-Smoke.

## Node-Runner

[run-tests.mjs](run-tests.mjs) entdeckt alphabetisch sortierte Dateien mit Endung `.test.mjs` direkt unter `tests/`. Helfer, Fixtures und weitere Unterverzeichnisse sind keine automatisch ausgeführten Tests. `TESTS_DIR` kann für Runner-Gegenproben ein anderes Verzeichnis setzen.

Jede ausführbare Testdatei läuft in einem eigenen Node-Prozess über [run-single.mjs](run-single.mjs). Der Runner hält ihre Ausgabe bis zum Prozessende zurück und empfängt die Zähler per IPC. Das schützt DOM-, Speicher- und Worker-Globals vor anderen Testdateien. Im normalen Lauf erscheint pro Datei eine Ergebniszeile; anschließend folgen Summen, Dauer und die langsamsten Dateien.

| Variable | Verhalten |
| --- | --- |
| `TEST_WORKERS` | positive ganze Zahl für die Zahl paralleler Testprozesse; ohne Angabe mindestens ein Prozess, sonst CPU-Zahl minus vier |
| `TEST_VERBOSE=1` | vollständige Dateiausgabe und erfolgreiche Assertions anzeigen |
| `TESTS_DIR` | alternatives Testverzeichnis für den Runner |
| `QUICK_TESTS=1` | veraltet; führt nur die hinterlegte schnelle Teilmenge aus und warnt |

Für einen reproduzierbaren Fehler zuerst die betroffene Datei einzeln ausführen. Wenn eine Ressourcen- oder Reihenfolgefrage offenbleibt, kann `TEST_WORKERS=1 npm test` den kompletten Lauf mit einem Worker prüfen. Es schaltet weder Policies noch Assertions ab.

### Assertions und Exit-Code

`run-single.mjs` installiert `assert`, `assertEqual` und `assertClose` global. `assertClose` weist auch nicht endliche Zahlen zurück. Ein Fehlschlag wirft `TestAssertionError`; eine ungefangene Import- oder Laufzeitausnahme zählt als Dateifehler.

Eine Datei mit null gezählten Assertions scheitert. Ein harter Prozessausstieg ohne IPC-Summary oder ein unerwarteter Exit-Code wird vom Elternrunner ebenfalls als Fehler gezählt. `npm test` beendet sich bei fehlgeschlagenen Assertions oder Dateien mit Exit-Code 1, sonst 0. Offene Handles werden gesondert gemeldet; ihre Meldung allein erhöht den Fehlerzähler nicht.

[legacy-assertion-loader.mjs](legacy-assertion-loader.mjs) instrumentiert die ausdrücklich hinterlegten Alttests mit lokalen Hilfen bzw. `node:assert`. Das ist keine pauschale Erfassung aller Assertionbibliotheken. Neue Tests verwenden die gezählten globalen Assertions. Ein eigener `console.log` mit „PASS“ ersetzt keine Assertion.

### Ausführungspolicy

`TEST_EXECUTION_POLICY` und `getTestExecutionPolicy` in [run-tests.mjs](run-tests.mjs) bestimmen die Ausführung. Standard ist `isolated`; die Ausführungsschleife unterstützt zusätzlich `serial` für Ressourcenprüfungen und `separate-gate` für externe Prüfwege. Aktuelle Sonderfälle stehen in der Policy, nicht in einem zweiten Testkatalog.

| Sonderfall | Voraussetzung und Einordnung |
| --- | --- |
| Browser-Smoke | immer separates Gate; Playwright, Chromium und lokaler Port nötig |
| Historische Backtest-Characterization | exakte Referenzwerte an Windows x64 und Node `v25.2.1` gebunden; auf anderen Laufzeiten separat gemeldet |
| Demografie-/Pflege-/Hinterbliebenen-Laufmessung | dieselbe festgelegte Windows-/Node-Laufzeit für bytegenaue Belege |
| Rekonstruktion der deutschen Cash-/Geldmarktreihe | Windows-Gate mit der hinterlegten Poppler-Version `25.07.0` |

Der Runner zeigt für ein separates Gate den Befehl und den Grund an. Es hat null Assertions im Node-Gesamtlauf und zählt als ausgelassene separate Prüfung. Auf einer passenden Referenzlaufzeit werden die dafür zugelassenen Plattformtests regulär ausgeführt. Der Einzeltest-Wrapper überspringt einen solchen Test nicht selbst; Plattformvoraussetzungen deshalb vor einem gezielten Aufruf prüfen.

## Testpflege

Tests prüfen beobachtbares Verhalten oder einen Vertrag. Änderungen an Engine, Workern, DOM-freien Runnern, Persistenz und gemeinsamen Verträgen benötigen die entsprechenden Fach- und Vertragsprüfungen nach [AGENTS.md](../AGENTS.md). Die Modulreferenzen zeigen Zuständigkeiten; Testbefehle werden hier gepflegt.

| Prüfart | Geeignete Belege |
| --- | --- |
| Fachtest | deterministische Eingabe, erwartete Entnahme/Aktion/Steuer und erkennbare Fehlerfälle |
| Runner-/Workertest | identische Seeds, Laufbereiche, Parameter und Datenversion; vollständiger Ergebnisbestand sowie Abbruchende |
| Persistenztest | Stringrecords, Vorschau vor Write, Kontextwechsel, Readback, Fehler und Recovery |
| DOM-Test | Bedienereignisse und Seitenstatus mit einem abgegrenzten Test-DOM |
| Quellvertrag | statisch prüfbare IDs, Modulgrenzen, Exportschemas oder Doku-Verweisziele |

Die Helfer unter [helpers/](helpers/) stellen unter anderem Balance-, Speicher- und Dialogfixtures bereit. [fixtures/](fixtures/) hält Schemata, Messverträge und deterministische Vergleichswerte. Neue Beispiele verwenden Max und Erika Mustermann und synthetische Daten. Keine privaten Exporte, realen Finanzdaten oder lokalen Speicherdateien übernehmen.

Temporäre Verzeichnisse über `node:os` anlegen und in `finally` aufräumen. Ersetzte Globals, Timer, Eventlistener und Mocks zurückbauen; asynchrone Arbeit vor dem Testende abwarten. Prozessisolation verhindert Konflikte zwischen Dateien, beseitigt aber keine offenen Fortsetzungen innerhalb derselben Datei.

Historische Auditbelege des Funktionsinventars bleiben im lokalen Baum prüfpflichtig. Veröffentlichte Stände ohne internes Archiv brauchen diese Entwurfsbelege nicht. Aktuelle Codequellen und Testbelege bleiben immer Pflicht.

Für Zufallspfade den Seed und die effektiven Modellannahmen festlegen. Fachliche Zahlungsunfähigkeit und technische Fehler getrennt prüfen. Eine neue erwartete Zahl aus demselben Rechenpfad allein ist kein unabhängiger Beleg. Bei veränderten Vergleichswerten die Ursache und den betroffenen Vertrag nachweisen.

## Separate Prüfungen

### Paritätscollector

[extended/paritaet.mjs](extended/paritaet.mjs) rechnet über [parity-scenarios.mjs](extended/parity-scenarios.mjs) den Muster-Haushalt Max und Erika Mustermann mit Aus, Konservativ, Ausgewogen und Offensiv für 2000–2025. Die Voreinstellungen kommen aus dem gemeinsamen Produktmodul und stehen auch im jeweiligen privaten Haushaltsplan. Je Jahr entstehen ein Replay aus dem aufgezeichneten Zustand und ein Fall aus dem unabhängigen Balance-Folgelauf. Diese Dateien liegen außerhalb der automatischen Testentdeckung.

[parity-balance-sequence.mjs](extended/parity-balance-sequence.mjs) übernimmt einmal Anfangsrecords und danach nur eingefrorene Marktereignisse. Eigene Bestände, Rentenbasis und Balancezustände werden ausschließlich nach belegbar ausführbaren Empfehlungen fortgeführt. Die Annahme „Empfehlung vollständig ausgeführt“ steht im Ausführungsbeleg. FR-10 hat die Kontenregel entschieden; dem unabhängigen Adapter fehlen persönliche Jahresendbuchungen. Er beendet den Pfad deshalb mit `NICHT_VOLLSTAENDIG_AUSFUEHRBAR` und `independent_annual_execution_adapter_missing`. Folgejahre melden die erste nicht ausführbare Periode und enthalten keine Engineentscheidung. Eine synthetische Folge ohne Kontobewegungen prüft die eigene mehrjährige Historie, Rentenfortschreibung und den echten Balance-Jahresentwurf.

`--pruefungen` startet getrennt die Collector-, Adapter- und Feldvergleichstests über [parity-replay-collector.mjs](extended/parity-replay-collector.mjs), [parity-balance-replay.mjs](extended/parity-balance-replay.mjs) und [parity-comparison.mjs](extended/parity-comparison.mjs). Die Resetfälle 2001 und 2002 sind nach der gemeinsamen Planregel gleich; Fachfrage 5 ist entschieden. [guardrail-history.test.mjs](guardrail-history.test.mjs) prüft Jahresindexierung, bewusste Änderungen, Verwerfen, Neuladen und erhaltene Steuerstände in beiden Wegen. Dazu gehören bytegleiche Ergebnisse mit und ohne Aufzeichnung, Kopien vor Mutationen, Schemafelder, Belegmanipulation, Fehlwerte und Nachrechnung nach JSON-Laden. [parity-scenarios-checks.mjs](extended/parity-scenarios-checks.mjs) prüft frühe wirtschaftliche und technische Terminalfälle, unveränderte Eingaben und die Exitentscheidung. Der normale Szenarienlauf bleibt dadurch kurz; seine unveränderten Eingaben werden in jedem Lauf geprüft.

Der Adaptertest vergleicht seine Ergebnisse mit direkten Aufrufen des echten Balance-Readers und der Haushaltsrechnung. Er prüft Personenjahre und Bezugsmonate, belegte Personenalternativen, Lots samt Besitzer und Kosten, Planhistorie, Reset und alle drei Verteilmodi. Schreibmethoden des privaten Adapters müssen werfen; Zugriffe auf globale Browser-/Speicher-/Netzschnittstellen sind während der Nachrechnung mit Fehlerfallen gesperrt. Der Feldvergleich prüft Toleranzen, Quellenbeträge je Besitzer, Nullverwendungen, Entnahmereihenfolge und Phasen. Eine absichtlich um einen Euro veränderte Monatsentnahme muss trotz offener Fachfragen als technischer Fehler auffallen. Fehlende Quellen, offene Fachfragen und das fehlende Personenmodell können kein grünes Gesamtergebnis liefern.

[parity-d23.mjs](extended/parity-d23.mjs) rechnet mit `--pruefungen` die 13 ursprünglichen Belege unter [fixtures/parity-d23/](extended/fixtures/parity-d23/) nach. Das Manifest sichert ihre unveränderten Bytes. [parity-d23-probes.mjs](extended/parity-d23-probes.mjs) übernimmt die ursprünglichen Messwege ohne Erzeugungs- oder Schreibpfad. Die Fälle `4-drei-toepfe-rendite`, `5-drei-toepfe-phase` und `11-drei-toepfe-steuerreserve` prüfen FR-8, FR-9 und die gedeckte Steuerreserve; alle drei müssen gleich sein. Der Phasenfall erreicht vor Auszahlung 150.000 Euro Anleihen, der Reservefall läuft ohne Enginefehler. Die Fälle `3-horizont`, `6-jahresrentenrundung`, `8-partnerrente`, `9-ath-phase` und `12-jahresfortschreibung-rundung` prüfen FR-11, FR-13, FR-14 und FR-15 ebenfalls gegen gleiche Sollwerte. [planning-horizon-parity.test.mjs](planning-horizon-parity.test.mjs) prüft zusätzlich mehrere Planungsjahre, alle Langlebigkeitsmodi, Haushaltsauswahl, Altalter, Planreset und den bestehenden Dateiexport. Die historischen Beobachtungen bleiben in den bytegleich erhaltenen Fixtures lesbar. Die isolierte Steuerreserveprobe muss ohne Enginefehler laufen. FR-10 prüft `7-cashaufteilung` ohne Liquiditäts- oder Reichweitendifferenz und `2-haushalt` mit gleichen persönlichen Auszahlungen. Der Fall `2-haushalt` verlangt auch gleiche Quellen und persönliche Verkaufssteuern. [simulator-personal-tax.test.mjs](simulator-personal-tax.test.mjs) prüft getrennte Freibeträge, Kirchensteuer, Teilfreistellung und Verlustvorträge, Geldmarktgewinne samt Steuerfinanzierung, Ansparen und kleine MC-/Sweep-Läufe. [simulator-personal-accounts.test.mjs](simulator-personal-accounts.test.mjs) prüft alle Verteilmodi, Teil- und Vollverbrauch, Kostenbasis, Kaufbesitzer, Zinsen, Steuerbuchung, Altinputs und mehrjährige Balance-Replays. Es gibt keinen Schalter zum Neubasieren der Ausgangsbefunde.

[personal-tax-benchmark.mjs](extended/personal-tax-benchmark.mjs) misst MC und Sweep mit persönlicher Steuer gegen eine private vollständige PA-A6-Quellkopie. Aufruf: `PERSONAL_TAX_BASELINE_DIR=<Basiskopie> node tests/extended/personal-tax-benchmark.mjs`. Die Kopie enthält `app/`, `engine/`, `types/`, `workers/`, `data/` und `package.json`. Identische Eingaben und Seed 12345 laufen nach drei Warmläufen in sieben abwechselnden Messpaaren mit je drei Wiederholungen; gemeldet wird der Median je Chunk. Die Aufzeichnung bleibt aus. Ergebnisse dürfen sich durch die beschlossene Steuerangleichung unterscheiden.

```sh
npm run test:paritaet -- --ausgabe .paritaet/cases
npm run test:paritaet -- --fall .paritaet/cases/konservativ-recorded-2002.json
npm run test:paritaet -- --fall .paritaet/cases/konservativ-sequence-2002.json
npm run test:paritaet -- --pruefungen --ausgabe .paritaet/probes
npm run test:paritaet -- --fall .paritaet/probes/5-drei-toepfe-phase.json
```

`--ausgabe` wählt den Prüf- oder Scratch-Ordner. Ohne diesen Schalter legt der normale Lauf einen neuen Ordner `paritaet-*` im temporären Systemverzeichnis an. Er schreibt 208 Szenarienfälle und `zusammenfassung.json`; vorhandene Dateien werden nicht überschrieben. `--pruefungen --ausgabe` exportiert die 17 Gegenproben separat. Konsolenzeilen zählen je Szenario gleiche Entscheidungen (`decisionEqualYears`), gleiche persönliche Transaktionspläne (`transactionEqualYears`) und vollständig gleiche Jahre (`equalYears`) getrennt. Dazu kommen Rundung, offene Fachfragen, Modelllücken und Fehler; die Kategorien können sich überschneiden. Vollständige Gleichheit verlangt beide vollständigen Jahresvergleiche. Die Zusammenfassung enthält außerdem Einzelbefunde, Fehlerfelder, Herkunft und die gemessene Laufzeit von Szenarien und Export; das Ziel liegt unter zehn Sekunden.

Im Szenarienlauf muss jede verbleibende Lücke in [parity-residuals.mjs](extended/parity-residuals.mjs) mit passendem Status, konkretem Grund und Feld erfasst sein. `residuals.classes` nennt Fall-/Feldzahlen, Jahre und Beispiele; `residuals.unclassified` muss leer bleiben. Bekannte Modell-/Loglücken setzen den Exitcode nicht. Technische Fehler und unklassifizierte Abweichungen setzen ihn auf 1, auch bei bereits bekannten technischen Befunden. Die absichtlichen Gegenproben werden auf Reproduktion geprüft und zählen nicht als neu aufgetretene Szenarienfehler. `--fall` rechnet nur die gewählte Datei nach und prüft ihre gespeicherte Beobachtung. Ein Folgelauffall enthält die Anfangsrecords und alle benötigten externen Ereignisse; er benötigt keine anderen Dateien. Ein erfolgreicher Einzelreplay bestätigt die Reproduktion und keine Paritätsfreigabe. Die [Abschlussmessung](../docs/reference/PARITY_REPLAY.md#jahresvergleich-und-restklassen) erklärt Teilgleichheit und Restklassen.

[parity-user-impact.mjs](extended/parity-user-impact.mjs) misst Monatsbudget und Monatsentnahme vor und nach der Angleichung in den Marktjahren 2000/2001 sowie die MC-Erfolgsquote über 100 Läufe mit maximal 26 Jahren. Beide Versionen lesen dieselben synthetischen Anfangsrecords und gepatchten Voreinstellungen; der Haushaltsplan und die anfängliche Marktherkunft werden wie im Szenarienlauf gesetzt. Der Seed ist 12345, Blockgröße 3, Methode `block`, RNG `per-run-seed`, Startjahre `UNIFORM`, CAPE-Sampling an. Ein technischer Fehler ergibt `percent: null`, `failed: true` und Exitcode 1, keine bereinigte Quote. Die vollständige private Basiskopie kommt aus dem Stand unmittelbar vor der ersten fachlichen Angleichung:

```sh
mkdir -p .paritaet/impact-before
git archive ae2179d2 app engine types workers data package.json tests/extended | tar -x -C .paritaet/impact-before
PARITY_IMPACT_BASELINE_DIR=.paritaet/impact-before node tests/extended/parity-user-impact.mjs > .paritaet/impact.json
```

[simulator-personal-tax-liquidity.test.mjs](simulator-personal-tax-liquidity.test.mjs) prüft FR-16: Partner-Tagesgeld und Partner-Geldmarkt vor eigenen Notverkäufen, Teildeckung mit zusätzlicher Verkaufssteuer, die Reihenfolge bei drei Personen in allen Haushaltsmodi, persönliche Steuertöpfe, Vermögensfluss und Ruin bei ungedeckter Steuer. Der frühere Offensiv-Abbruch läuft mit `runRange: { start: 16, count: 1 }` über Jahrindex 21 hinaus. `node tests/extended/personal-tax-liquidity-mc.mjs` misst ohne Basiskopie alle vier Voreinstellungen mit je 100 Läufen und denselben Parametern; jede Quote muss auswertbar sein. Ergebnisse und Regelherkunft stehen im [Replayvertrag](../docs/reference/PARITY_REPLAY.md#jahresvergleich-und-restklassen).

[parity-node-hash.mjs](extended/parity-node-hash.mjs) liefert für die privaten Belegfunktionen dieselbe kanonische Serialisierung mit nativem SHA-256. Portable und native Berechnung müssen identische vollständige Fälle liefern. Der Quellhash umfasst Produktquellen und die erweiterten Prüfskripte; ein unbekannter Git-Revisionswert bleibt ausdrücklich eine Loglücke.

Der Benchmark lädt die beiden ursprünglichen Jahresmodule lesend aus der festgelegten Basisrevision. Er schreibt die Vergleichsmodule ausschließlich in einen eigenen temporären Ordner und räumt diesen auf. Die übrigen Produktmodule bleiben identisch. Neun abwechselnde Messpaare mit je drei Läufen zeigen Median und Median der absoluten Abweichungen der Differenzen. Ein positiver Unterschied oberhalb von drei dieser Abweichungen und zwei Prozent der bisherigen Laufzeit gilt als messbarer Aufwand. Die Messung gibt Rohwerte aus; sie setzt keine zeitabhängige Testschranke.

Wenn die Sandbox Node-Unterprozesse sperrt, lassen sich die beiden Basisdateien vorab im Projektordner unter `.paritaet/` bereitstellen:

```sh
mkdir -p .paritaet/baseline
git show f99a62cd9920fa589239f21bff593bd1e7aeeb8d:app/simulator/simulator-engine-direct.js > .paritaet/baseline/simulator-engine-direct.js
git show f99a62cd9920fa589239f21bff593bd1e7aeeb8d:app/simulator/simulator-engine-wrapper.js > .paritaet/baseline/simulator-engine-wrapper.js
PARITY_BASELINE_DIR=.paritaet/baseline npm run test:paritaet -- --benchmark
```

### Browser und EXE

[browser-smoke.test.mjs](browser-smoke.test.mjs) startet seinen eigenen Server auf einem freien lokalen Port und lädt Chromium aus Playwright. Es bereitet Browserkontexte und Testrecords vor. Ein separat gestarteter App-Server ist dafür nicht erforderlich. Fehlendes Chromium oder ein gesperrter Server-/Browserstart verhindert diesen Prüfweg.

Bestehende Browserfälle sichern Seitenstart, Profilübergaben, Abschlüsse, Navigation und Datenerhalt. Für Zwischenzustände keine neuen Browserfälle anlegen, die der nächste Oberflächenumbau ersetzt. Neue Logik zunächst durch Node-/DOM-Tests belegen. Manuelle Bedienung mit Maus und Tastatur in der Kandidaten-EXE bleibt ein eigener Schritt; Zielauflösungen sind 1920×1080 und 2560×1440. Fokusdetails, andere Auflösungen und weitere Härtung folgen den Entwicklungsgrundsätzen.

Keine Druckansichten oder Druckprüfungen neu anlegen, erweitern oder nachbessern. Die App hat keinen beauftragten Druckworkflow. Eine ausschließlich am Druckvertrag scheiternde Prüfung wird nach der Projektregel begründet herausgenommen.

### Orchestrator und Sandbox

Im orchestrierten Lauf führt allein der Orchestrator die volle Suite aus. Implementierer dürfen gezielte Einzeltests starten. Browser-Smoke fährt die gesteuerte Sitzung vor dem lokalen Merge; er gehört nicht zur Orchestratorvalidierung. Der Handbetrieb folgt dem jeweiligen Auftrag und [AGENTS.md](../AGENTS.md).

Sandboxfehler wie `spawnSync ... EPERM`, ein gesperrter Port oder ein nicht startbarer Browser sind Ausführungsgrenzen. Im Bericht die betroffene Prüfung und Ursache nennen. Keine Fachwerte ändern, um diese Umgebungssperren zu umgehen. Die außerhalb der Sandbox vorgesehene Prüfung bleibt offen, bis sie tatsächlich gelaufen ist.

## Coverage

[run-coverage.mjs](run-coverage.mjs) ersetzt den bisherigen `.coverage/`-Ordner, setzt `NODE_V8_COVERAGE` für die Node-Suite und startet danach [coverage-report.mjs](coverage-report.mjs) mit aktivierten Dateigrenzen. Ein fehlgeschlagener Testlauf wird nicht als erfolgreicher Coveragebericht ausgegeben.

Der Bericht verarbeitet V8-Bereiche für geladene Dateien unter `app/`, `engine/`, `workers/` und `types/`. Daraus schätzt er ausführbare und abgedeckte Zeilen. `.coverage/summary.json` enthält je Datei Zeilenzähler und Prozentwert sowie die Gesamtsumme. Browsercode, der nur im separaten Chromium-Lauf ausgeführt wird, ist nicht Bestandteil dieser Node-Messung. Auch die Auswahl geladener Projektdateien begrenzt den Nenner; die Summe ist kein Nachweis aller Bedienabläufe.

Zwei Dateien müssen jeweils mindestens 50 % erreichen: `app/simulator/worker-job-runner.js` und `app/simulator/results-renderers.js`. Eine fehlende Datei im Bericht scheitert an ihrer Grenze. Es gibt keinen daraus abgeleiteten pauschalen Gesamtprozentvertrag. [coverage-inventory.mjs](coverage-inventory.mjs) kann Datei- und Importbelege auswerten; eine Importbeziehung allein beweist keine Ausführung.

## Schutzprüfungen

| Prüfung und Quelle | Gepflegter Vertrag |
| --- | --- |
| [engine-wrapper-contract.test.mjs](engine-wrapper-contract.test.mjs) | reiner Modul-Wrapper, Import-Einstieg, Globals und Generatorverhalten; ein IIFE-Bundle erfüllt den bestehenden Vertrag nicht |
| [core-engine.test.mjs](core-engine.test.mjs), [worker-parity.test.mjs](worker-parity.test.mjs) | Engine-Jahresvertrag und Parität zwischen serieller Rechnung und Workern |
| [funktionsinventar.test.mjs](funktionsinventar.test.mjs), [funktionsinventar-contract.mjs](funktionsinventar-contract.mjs) | Schema, vorhandene Quellen und generierte Lesesicht des Funktionsinventars |
| [generate-funktionsinventar.mjs](../scripts/generate-funktionsinventar.mjs) | Lesesicht aus dem JSON-Inventar erzeugen; keine zweite handgeschriebene Funktionsliste |
| [architecture-evidence.test.mjs](architecture-evidence.test.mjs), [check-architecture-evidence.mjs](../scripts/check-architecture-evidence.mjs) | Modell-/Architekturanker und Zuordnung zu Evidenzrecords |
| [docs-pruefen.test.mjs](docs-pruefen.test.mjs), [docs-pruefen.mjs](../scripts/docs-pruefen.mjs) | lokale Links, fertige Prüfgruppen und statische Doku-Gegenproben |
| [tauri-release-config.test.mjs](tauri-release-config.test.mjs) | Release „Vermögen & Ruhestand“, EXE `VermoegenUndRuhestand.exe` und unveränderte Kennung `de.vermoegen-ruhestand.suite`; Entwickler „Vermögen & Ruhestand Entwicklung“, Cargo-/EXE-Name `vermoegen_und_ruhestand` und Kennung `de.vermoegen-ruhestand.entwicklung`; Kandidatenkennung mit `.kandidat` |

Die Probelauf-Tests prüfen aktuelle Entwickler-, Kandidaten- und Produktivkennungen sowie die alte Kennung `com.dieter.ruhestandsapp` einschließlich ihrer früheren Kandidaten. Diese alten Werte belegen weiterhin die Kompatibilität mit der alten App.

Mermaid-Blöcke in aktiven Markdown-Dateien werden auf geschlossene Zäune, die erste Zeile (`flowchart TD`, `flowchart LR` oder `sequenceDiagram`), leere Kanten und 1 bis 25 eindeutige Knoten geprüft. Bei Sequenzen zählen die Teilnehmer als Knoten. Die Prüfung erfasst einfache Beschriftungen und Ketten; sie ersetzt keinen vollständigen Mermaid-Syntaxparser. Diagrammbeispiele innerhalb anderer Codeblöcke bleiben ausgenommen.

Die Dokuprüfung startet keinen Browser und ruft keine Webquellen ab. Bildverzeichnis, Manifest und beide Ablaufseiten werden vollständig geprüft. Fehlende Bilder, falsche Maße oder Herkunft, ungültige Ausschnitte sowie abweichende Dateigrößen und Prüfsummen sind Fehler. Insgesamt gelten höchstens 8 MB; über dem Wunschziel von etwa 4 MB erscheint eine Warnung. Das Handbuch wird vollständig geprüft. Fehlende Hauptanker, Hilfeziele und doppelte IDs sind Fehler. Bedienelementbelege umfassen HTML, Renderer und die belegbaren DOM-Erzeugungen der Abschlussdialoge.

Das [Bildwerkzeug](../scripts/docs-bilder.mjs) startet Server und Chromium selbst und gehört nicht in `npm test`. Die [Anleitung](../docs/ui/README.md#bilder-erneuern) erklärt das Erneuern und die Sichtprüfung. Floskeltreffer bleiben Warnungen, die vor der Abgabe korrigiert oder einzeln begründet werden müssen. Satzbau und Verständlichkeit prüft die eigene Gegenlese: kurze, konkrete Sätze, „du“ in Nutzertexten, keine Floskeln oder Werbesprache.
