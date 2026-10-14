# Auto-Optimize

[auto_optimize.js](../../app/simulator/auto_optimize.js) vergleicht Kandidaten innerhalb eines begrenzten Parameterraums. Der Champion ist ein modellinterner Szenariokandidat. Suchraum, Monte-Carlo-Annahmen und Bewertungsgröße begrenzen das Ergebnis; eine globale Suche oder externe Strategievalidierung folgt daraus nicht.

Die [Simulatorreferenz](SIMULATOR_MODULES_README.md) führt Eingabe- und Ergebnisanschlüsse. Kennzahlen und Modellgrenzen stehen im [Fachkonzept](FACHKONZEPT.md), gemeinsame Plan-/Ergebnisformen in [DATENVERTRAEGE](DATENVERTRAEGE.md).

Der [wissenschaftliche Rahmen](WISSENSCHAFTLICHER_RAHMEN.md#vergleiche-und-auto-optimize) erklärt Auswahlverzerrung und die Grenze getrennter Seeds. Die [offenen Forschungsnachweise](FORSCHUNGSABGLEICH_EVIDENZREGISTER.md#offene-nachweise) führen Versuchsinventar, Holdout und unabhängigen Review.

## Auftrag und Parameter

Der Request bestimmt Parameterbereiche, Objective mit Richtung, Constraints, Laufzahl je Kandidat, Dauer und Anzahl der Train-/Bestätigungsseeds. `dynamicFlexMode` kann die Basis übernehmen oder Dynamic Flex ausdrücklich ein-/ausschalten. Unanwendbare Parameter und ungültige Bereiche werden vor der Suche zurückgewiesen.

| Modul unter `app/simulator/` | Zuständigkeit |
| --- | --- |
| [auto_optimize.js](../../app/simulator/auto_optimize.js) | Suchstufen, Seeds, Cache, Ergebniswahl und Modellstatus |
| [auto_optimize_ui.js](../../app/simulator/auto_optimize_ui.js) | Dokumentlauf, Formular, Fortschritt, Abbruch und Championanschluss |
| [auto-optimize-param-meta.js](../../app/simulator/auto-optimize-param-meta.js) | kanonische Parameterdefinitionen, Anwendbarkeit, Input-/Formmapping und Fingerprints |
| [auto-optimize-sampling.js](../../app/simulator/auto-optimize-sampling.js) | Latin-Hypercube-Kandidaten und reduzierte Nachbarschaft erzeugen |
| [auto-optimize-evaluate.js](../../app/simulator/auto-optimize-evaluate.js) | Kandidat auf kopierte Inputs anwenden und MC-Werte zusammenführen |
| [auto-optimize-worker.js](../../app/simulator/auto-optimize-worker.js) | MC-Batches seriell oder über Worker rechnen |
| [auto-optimize-metrics.js](../../app/simulator/auto-optimize-metrics.js) | Objective und Constraints aus gültigen Metriken auswerten |
| [auto-optimize-utils.js](../../app/simulator/auto-optimize-utils.js) | Kandidatencache und Gleichstandsordnung |
| [auto-optimize-apply.js](../../app/simulator/auto-optimize-apply.js) | geprüften Champion ins Formular übernehmen und Wirkung zurückprüfen |
| `auto-optimize-presets.js`, `auto-optimize-renderer.js` | Sucheingaben vorbelegen und Ergebnisse anzeigen |

Die interaktive Parameterliste stammt aus `AUTO_OPTIMIZE_PARAMETER_OPTIONS`. Sie enthält `liquidityRunwayYears`, `goldTargetPct`, `goldRebalancingBand`, `maxSkimPct`, `survivalQuantile` und `goGoMultiplier`. Die Oberfläche erlaubt ein bis sieben Parameterzeilen. Die Registry unterstützt außerdem explizite Kompatibilitätsrequests mit `horizonYears` und `maxBearRefillPct`; diese sind keine angebotenen Suchdimensionen.

`horizonYears` ist nur für einen direkten Horizont anwendbar. Aktuarische Horizontmethoden bestimmen ihn aus ihrem Modell. Die Registry ordnet jeden Suchwert einem wirksamen Input und Formularziel zu; Aliasse sind keine zweite Parameterdefinition. `auto-optimize-params.js` enthält ältere Konfigurationsmutatoren. Der aktuelle Such-/Bewertungspfad verwendet die kanonische Registry in `auto-optimize-param-meta.js`.

## Bewertung und Suchstufen

`AutoOptimizeEvaluationContractV1` friert kanonische MC-Parameter, CAPE-Sampling und effektive Datenauswahl ein. Train- und Bestätigungsseeds werden aus dem gemeinsamen Seed abgeleitet; je Gruppe sind 1 bis 20 Seeds zulässig. Die Gruppen werden auf Überschneidung geprüft. Kandidatenvergleich und aktuelle Vergleichskonfiguration erhalten dieselben Bewertungsannahmen.

Die Kandidatengenerierung nutzt Latin Hypercube Sampling mit dem im Core festgelegten Zufallsstart. Nach der Gültigkeitsprüfung folgen diese Stufen:

1. Der Quick-Filter rechnet höchstens 200 Läufe, sonst rund 10 % der vollen Laufzahl, mit bis zu zwei Train-Seeds. Er sortiert nach Objective und wendet noch keine harten Constraints an.
2. Volle Evaluation bewertet bis zu 50 Quick-Kandidaten mit der beauftragten Laufzahl und den Train-Seeds. Nur zulässige Kandidaten gehen weiter.
3. Verfeinerung erzeugt Nachbarn um bis zu fünf führende Kandidaten. Gültige Nachbarn werden voll bewertet und mit den bisherigen Kandidaten zusammen sortiert.
4. Bestätigung rechnet bis zu drei führende Kandidaten auf separaten Seeds. Nur erneut zulässige Resultate bleiben; der Champion wird nach der Testbewertung gewählt.
5. Die aktuelle Konfiguration wird auf derselben Bestätigungsbasis verglichen. Ergebnis, Delta und Stabilitätsmaß werden gemeinsam ausgegeben.

Wenn keine Kandidaten eine Stufe erfüllen, scheitert der Lauf mit einem erklärten Fehler. Ein vorheriger Champion ist kein Ersatzresultat des gescheiterten Laufs. Train-/Testwerte bleiben im fertigen Ergebnis unterscheidbar.

| Objective | Gelesene Ergebnisgröße |
| --- | --- |
| `EndWealth_P50`, `EndWealth_P25` | angefordertes Endvermögensquantil |
| `SuccessRate` | `successProbFloor` |
| `Drawdown_P90` | `worst5Drawdown` nach dem vorhandenen Metrikvertrag |
| `TimeShare_WR_gt_4_5` | `timeShareWRgt45` |
| `Median_WR` | `medianWithdrawalRate` |

`direction = min` negiert den Wert für die gemeinsame absteigende Sortierung. Fehlende oder nicht endliche Objectivewerte werden zurückgewiesen. Die aktivierten Constraints prüfen mindestens 99 % Floor-Erfolg, höchstens 0,5 % Erschöpfung, höchstens 1 % Zeitanteil über der Entnahmequotenreferenz und höchstens 55 % der Drawdown-Metrik. Ein fehlender Constraintwert erfüllt die Bedingung nicht. Bedeutung, Nenner und Betragsbasis dieser Metriken stehen im [Fachkonzept](FACHKONZEPT.md).

Der Evaluator prüft Rohverteilungen, Beobachtungszahlen und Missingness vor der Aggregation über Seeds. `AutoOptimizeMetricResultV1` hält die auswertbare Stichprobe fest. Technische Fehler werden gesondert geführt; sie sind keine finanziellen Nullwerte. Parameter- und Requestfingerprints müssen den tatsächlich bewerteten Kandidaten bestätigen. Dynamic-Flex-Safetyguards können die Rangbewertung zusätzlich beeinflussen, ohne den gemessenen Objectivewert zu ersetzen.

## Parallelisierung und Abbruch

Core bewertet Kandidaten in Promise-Batches mit bis zu vier Kandidaten. Die darunterliegenden MC-Batches laufen über [workers/worker-pool.js](../../workers/worker-pool.js) und den gemeinsamen [mc-worker.js](../../workers/mc-worker.js). Es gibt keinen separaten Worker, der die gesamte Kandidatensuche besitzt. Ohne Worker verwendet `auto-optimize-worker.js` den seriellen `runMonteCarloChunk`.

Initialisierung und Jobs tragen Datenversion und Generation. Chunks werden über den gemeinsamen MC-Ergebnisvertrag validiert und vollständig finalisiert. Ein normaler Workerfehler schließt offene Jobs ab und kann seriell neu rechnen. Abbruch beendet die Generation und startet keinen Ersatzlauf.

`handleRunAutoOptimize` führt je Dokument einen Singleflightlauf. `cancelAutoOptimize` signalisiert Abbruch und wartet auf das ganze Handlerende einschließlich Kandidaten, Seeds und Cleanup. Core wartet auch bei einem fehlgeschlagenen Kandidaten auf die parallelen Fortsetzungen. Nach Abbruch darf keine spätere Fortsetzung Fortschritt oder Champion veröffentlichen.

Der Navigationsprovider `simulator-auto-optimize` unterscheidet Vorbereitung/Rechnung, Kündigung und vorhandenen Champion. Bestätigte Navigation wartet das Ende ab. Ein fertiger Champion bleibt bei einem abgebrochenen oder fehlgeschlagenen Folgelauf sichtbar. Download und Formularübernahme beseitigen diesen Ergebnisbestand nicht. Gemeinsame Reset-/BFCache- und EXE-Schließgrenzen stehen in [TECHNICAL](TECHNICAL.md#navigation-und-laufende-operationen).

## Ergebnisstatus und Übernahme

`AutoOptimizeModelStatusV1` führt Modellversion, Jahresdaten-/Regimehash, effektive Startjahr-/Estimated-History-Auswahl und `methodClassification = experimental`. Technischer Teststatus, interne Plausibilisierung und externe Validierung sind getrennte Achsen. Ein Testlauf ändert deren fachliche Einstufung nicht automatisch.

Ein injizierter Custom-Evaluator wird als `custom_evaluator` ausgewiesen. Er erhält keine eingebauten Datenhashes und beansprucht weder deren technischen noch internen Bewertungsstatus. Das Statusobjekt beschreibt die Modellbeleggrenze, keine Messung der aktuell laufenden Tests.

<!-- docs:control {"source":"Simulator.html","selector":"#ao_apply_btn","text":"Konfiguration übernehmen"} -->
„Konfiguration übernehmen“ verwendet `applyChampionToForm`. Vor dem Schreiben prüft das Modul Parameter- und Requestfingerprint sowie erreichbare, anwendbare Formularziele. Nach den Feldänderungen liest es die wirksamen Inputs zurück und vergleicht beide Fingerprints erneut. Ein fehlender gemeinsamer Plan oder ein bestätigter Plan ohne aktiven lokalen Versuch blockiert die Übernahme.

Die Übernahme füllt einen lokalen Planversuch. Eine zentrale Planbestätigung läuft über dessen eigenen Editor und Schreibvertrag. Weder die Suche noch ein Download ändern einen realen Depotbestand. Die Resultate bleiben an ihre ursprünglichen Annahmen gebunden; neue Sucheingaben berechnen keinen bestehenden Champion um.

Die technischen Parameter-, Metrik-, Worker- und Übernahmeprüfungen sind im [Test-README](../../tests/README.md#schutzprüfungen) eingeordnet. Eine neue Suchdimension muss in Registry, Request, Evaluation und wirksamer Formularübernahme denselben Wert erhalten.
