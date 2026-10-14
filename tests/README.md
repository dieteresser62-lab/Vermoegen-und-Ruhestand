# Tests und Prüfwege

`npm test` startet den Node-Runner aus [package.json](../package.json). Er prüft Fachlogik, Datenverträge und die mit Test-DOMs ausführbaren Seitenabläufe. Browser-Smoke, Coverage und Builds haben eigene Befehle.

Zwischenstände müssen manuell bedienbar sein und ihre Daten bewahren. Automatisierte Tests sichern Grundbedienung und Datenpfade; Nutzerbefunde haben Vorrang. Eine vollständige Browsersuite für den fertigen Oberflächenstand und weitere Härtung folgen in ihrer eigenen Phase.

## Befehle

Im Repositorywurzelverzeichnis ausführen. Die Skripte stehen in [package.json](../package.json); ein Einzeltest läuft über den Wrapper, damit seine Assertions gezählt werden.

| Befehl | Zweck |
| --- | --- |
| `npm test` | alle vom Runner entdeckten Node-Testdateien nach Ausführungspolicy prüfen |
| `node tests/run-single.mjs tests/<datei>.test.mjs` | eine gezielte Testdatei ausführen |
| `npm run test:browser` | Playwright-Smoke mit eigenem lokalen HTTP-Server und Chromium |
| `npm run test:coverage` | Node-Suite mit V8-Coverage und anschließenden Dateigrenzen prüfen |
| `npm run docs:pruefen` | aktive Doku, Bildmanifest, PNG-Maße, Dateigrößen und lokale Verweise statisch prüfen |
| `npm run docs:bilder` | 40 App-Bilder mit Playwright und festem Muster-Haushalt erneuern; Doku-Werkzeug außerhalb der Tests |
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
