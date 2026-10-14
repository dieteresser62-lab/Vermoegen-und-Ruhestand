# Engine-Module und Aufrufverträge

[engine/index.mjs](index.mjs) exportiert `EngineAPI` und `_internal_calculateModel`, zusätzlich gemeinsam als Default-Objekt. Die Engine berechnet einen Jahresvorschlag aus Eingaben und Vorjahresstate. Sie verwaltet weder DOM noch Profilpersistenz.

Die [Entscheidungsfolge](../docs/reference/ENGINE_DECISION_LOGIC.md) erklärt die Reihenfolge der Fachschritte. Modelle und Formeln stehen im [Fachkonzept](../docs/reference/FACHKONZEPT.md), gespeicherte Records in den [Datenverträgen](../docs/reference/DATENVERTRAEGE.md). Wrapper, Globals und Auslieferung gehören zur [technischen Architektur](../docs/reference/TECHNICAL.md#engine-wrapper).

## Module

| Quelle | Zuständigkeit |
| --- | --- |
| [core.mjs](core.mjs) | Eingaben normalisieren, Jahresrechnung koordinieren, Aktion und Steuerabschluss abgleichen, API bereitstellen |
| [config.mjs](config.mjs) | Konfiguration sowie API- und Buildkennung |
| [validators/InputValidator.mjs](validators/InputValidator.mjs) | Feldfehler sammeln und gültige Eingaben von ungültigen unterscheiden |
| [analyzers/MarketAnalyzer.mjs](analyzers/MarketAnalyzer.mjs) | Marktsignale und Regime aus Jahresständen und CAPE ableiten |
| [analyzers/regime-signals.mjs](analyzers/regime-signals.mjs) | Signale für die Marktklassifikation aufbereiten |
| [planners/SpendingPlanner.mjs](planners/SpendingPlanner.mjs) | Entnahme, Folgestate und Bedarfsdiagnose erzeugen |
| [planners/spending-policy-pipeline.mjs](planners/spending-policy-pipeline.mjs) | Alarm, Guardrails, Mindest-Flex, Budget, finale Glättung und Safety-Cap ausführen |
| [planners/flex-rate-policy.mjs](planners/flex-rate-policy.mjs), [wealth-reduction.mjs](planners/wealth-reduction.mjs) | Flex-Rate und Vermögensdämpfung berechnen |
| [planners/alarm-policy.mjs](planners/alarm-policy.mjs), [spending-guardrails.mjs](planners/spending-guardrails.mjs) | Alarm- und Guardrailentscheidungen liefern |
| [planners/minimum-flex-policy.mjs](planners/minimum-flex-policy.mjs), [flex-budget-policy.mjs](planners/flex-budget-policy.mjs), [final-rate-policy.mjs](planners/final-rate-policy.mjs) | Mindestziel, Budgetgrenze und Änderungsgrenzen anwenden |
| [planners/vpw-return-policy.mjs](planners/vpw-return-policy.mjs) | Erwartete reale Rendite für Dynamic Flex ableiten |
| [planners/spending-diagnosis.mjs](planners/spending-diagnosis.mjs), [flex-trace.mjs](planners/flex-trace.mjs) | Diagnose und optionalen Flex-Trace aufbereiten |
| [transactions/TransactionEngine.mjs](transactions/TransactionEngine.mjs) | Transaktionsfunktionen bündeln |
| [transactions/transaction-utils.mjs](transactions/transaction-utils.mjs) | Liquiditätsziel, Handelsgrenzen und Quantisierung berechnen |
| [transactions/transaction-action.mjs](transactions/transaction-action.mjs) | Auffüllung, Verkauf oder keine Aktion wählen |
| [transactions/transaction-opportunistic.mjs](transactions/transaction-opportunistic.mjs), [transaction-surplus.mjs](transactions/transaction-surplus.mjs) | Opportunistische Auffüllung und Investition überschüssiger Liquidität prüfen |
| [transactions/sale-engine.mjs](transactions/sale-engine.mjs) | Verkaufsquellen und steuerliche Rohwerte bestimmen |
| [transactions/three-bucket-logic.mjs](transactions/three-bucket-logic.mjs) | Anleiheersatz und Auffüllung im Drei-Topf-Modus finalisieren |
| [tax-settlement.mjs](tax-settlement.mjs) | Jahressteuer und nächsten Verlustvortrag berechnen |
| [errors.mjs](errors.mjs) | `AppError`, `ValidationError` und `FinancialCalculationError` definieren |

## API

`EngineAPI` hat fünf operative Methoden. Die drei Legacy-Methoden bleiben leere Stubs; sie liefern `undefined` und sammeln keine Entscheidungen.

| Methode | Rückgabe und Fehlerverhalten |
| --- | --- |
| `getVersion()` | `{ api, build }` aus der Konfiguration |
| `getConfig()` | das Konfigurationsobjekt `CONFIG` |
| `analyzeMarket(input)` | Marktanalyse; gefangene Fehler als `{ error: e.message }` |
| `calculateTargetLiquidity(profil, market, inflatedBedarf)` | berechnetes Liquiditätsziel; delegiert direkt an `TransactionEngine` |
| `simulateSingleYear(input, lastState, options)` | `{ input, newState, diagnosis, ui }` oder `{ error }` |
| `addDecision(step, impact, status, severity)` | Legacy-Stub |
| `updateDecision()` | Legacy-Stub |
| `removeDecision()` | Legacy-Stub |

`_internal_calculateModel(input, lastState, options)` verwendet dieselbe Rechnung. Es hat keinen äußeren Exception-Handler. Ein Validierungsfehler wird trotzdem als Fehlerresultat zurückgegeben; andere Ausnahmen können den direkten Aufruf verlassen. Anwendungsaufrufer nutzen deshalb die öffentliche API oder behandeln diese Ausnahmen selbst.

## Eingaben und Vorjahresstate

`simulateSingleYear` erwartet technische Zahlen und boolesche Werte, keine lokal formatierten Eurotexte. UI-Adapter übersetzen Namen und Einheiten vor dem Aufruf. Die historische Schreibweise `detailledTranches` gehört zum Enginevertrag.

| Eingabegruppe | Felder an der Enginegrenze |
| --- | --- |
| Bedarf | `floorBedarf`, `flexBedarf`, `minimumFlexAnnual`, Flex-Budgetwerte |
| Vermögen | `tagesgeld`, `geldmarktEtf`, `depotwertAlt`, `depotwertNeu`, `goldWert`, Kostenbasis und Detailtranchen |
| Person und Einkommen | `aktuellesAlter`, `startAlter`, `renteAktiv`, `renteMonatlich`, `sparerPauschbetrag`, `kirchensteuerSatz` |
| Markt | `inflation`, `endeVJ`, `endeVJ_1`, `endeVJ_2`, `endeVJ_3`, `ath`, `jahreSeitAth`, `capeRatio` bzw. `marketCapeRatio` |
| Liquidität | `liquidityRunwayYears`, `minCashBufferMonths`, Abschöpfungs-/Refillgrenzen; optional `aktuelleLiquiditaet` |
| Gold | `goldAktiv`, Ziel- und Floorquote, `rebalancingBand`, Steuerannahme |
| Dynamic Flex | `dynamicFlex`, `horizonYears`, `horizonMethod`, `survivalQuantile`, Go-Go- und Langlebigkeitswerte, `returnPolicy` |
| Drei Töpfe | `decumulation.mode`, `bondTargetFactor`, `drawdownTrigger`, `bondRefillThreshold` |

Core kopiert und normalisiert den Input. Einige fehlende Vermögenswerte werden zu `0`, Alter erhält einen Standardwert. Das ersetzt keine vollständige Eingabeprüfung im Aufrufer. `floorBedarf` und `flexBedarf` müssen endliche, nicht negative Zahlen sein; für eine aktive Rente gilt das auch für `renteMonatlich`.

`minimumFlexAnnual` ist ein nominales Jahresziel. Fehlt es oder ist es leer, verwendet Core `0`. Sonst wird es numerisch konvertiert und anschließend validiert: endlich, nicht negativ, höchstens `flexBedarf`. Zu große Werte werden zurückgewiesen und nicht still begrenzt.

`aktuelleLiquiditaet` überschreibt bei ausdrücklicher Angabe die Summe aus Tagesgeld und Geldmarkt. Dieser Wert muss bereits eine endliche, nicht negative Zahl sein. Eine fehlende Angabe verwendet die Summe. Die Reichweite ist kanonisch `liquidityRunwayYears`; Core entfernt die alten Felder `runwayMinMonths`, `runwayTargetMonths` und `targetEq` aus dem normalisierten Input. Die Feldprüfung verlangt 1 bis 10 Jahre in Halbjahren.

Ein positiver `capeRatio` hat bei der Normalisierung Vorrang vor `marketCapeRatio`. Wenn beide Felder vorliegen, prüft der Validator beide. `decumulation` wird auf `standard` oder `3_bucket_jilge` normalisiert; weitere alte Modusnamen sind Kompatibilitätseingaben.

`lastState` ist der explizite zweite Parameter. Er trägt unter anderem die Inflations-, Flex-, Budget-, Safety- und Steueranker. Core liest den Verlustvortrag daraus und liefert den nächsten unter `newState.taxState`. Die Engine speichert diesen State nicht. Balance entscheidet über den bestätigten Jahreswrite; Simulator und Worker reichen den State innerhalb ihres eigenen Pfads weiter. Aufrufer müssen einen passenden Vorjahresstate liefern, nicht das Ergebnis einer beliebigen Vorschau.

## Ergebnisse und Diagnose

| Ergebnisfeld | Bedeutung für den Aufrufer |
| --- | --- |
| `input` | normalisierte Recheneingaben |
| `newState` | Kandidat für das Folgejahr, einschließlich Steuer- und Safetyankern |
| `diagnosis` | Entscheidungs-, Guardrail-, Allgemein- und Parameterdiagnose |
| `ui.spending` | finanzierte Entnahme, Flex-Werte und Mindest-/Safetydiagnose |
| `ui.action` | finaler Vorschlag mit Quellen, Verwendungen, Steuerabschluss und Abgleich |
| `ui.vpw` | angeforderte und wirksame Dynamic-Flex-/Go-Go-Werte, Horizont und Renditeherkunft |
| `ui.threeBucket` | Diagnose des Drei-Topf-Pfads oder `null` |
| `ui.liquiditaet`, `ui.runway` | Deckung vor/nach der Aktion sowie Reichweite und Status |

`ui.vpw` bleibt auch bei deaktiviertem Dynamic Flex vorhanden. Die Diagnose unterscheidet eine gewünschte Aktivierung von einer durch Safety unterdrückten Aktivierung. Mindest-Flex-Ziel, finanzierter Flex und begrenzende Policy stehen im Spendingresultat. Deren Bedeutung und FR-6-Auswertung führt das [Fachkonzept](../docs/reference/FACHKONZEPT.md).

Der normale Steuerabschluss steht in `ui.action.taxSettlement`, der resultierende Verlustvortrag in `newState.taxState`. `deferTaxSettlement: true` unterstützt eine nachgelagerte Finalisierung, etwa für die Haushaltsattribution. Ein aufgeschobener Abschluss ist kein fertig abgerechneter Simulatorjahresvorschlag.

Core prüft die geplante Entnahme und die Quellen-/Verwendungsflüsse. Inkonsistente Aktionen erzeugen `FinancialCalculationError` mit Vertragskontext. Aufrufer dürfen eine fehlerhafte Aktion nicht durch null oder einen Zahlungsunfähigkeitsfall ersetzen.

### Optionaler Flex-Trace

Der dritte Parameter `{ includeFlexTrace: true }` schaltet `ui.spending.flexTrace` zu. Ohne diese Option wird kein Collector erzeugt. Balance fordert ihn für die lesende Diagnose an; die Rechenpfade für Monte Carlo, Sweep, Backtest und Replay brauchen ihn nicht.

Der Trace hält die tatsächlich durchlaufenen Flex-Schritte und deren Monatswirkung als eingefrorene Einträge fest. Nicht endliche Diagnosezahlen werden zu `null`. Entnahme, Aktion und Folgestate bleiben durch die Option unverändert. Reihenfolge und Diagnoseanschlüsse stehen in der [Entscheidungsreferenz](../docs/reference/ENGINE_DECISION_LOGIC.md#bedarf-und-flex-trace). Der Trace gehört nicht in persistierte States oder Ergebnisexporte.

### Fehlerresultate

`ValidationError.errors` enthält Feldfehler mit `fieldId` und `message`. `FinancialCalculationError.context` trägt den verletzten Vertrag und Rechenwerte. `AppError` ergänzt Kontext und Zeitstempel. `simulateSingleYear` fängt Ausnahmen, protokolliert sie und liefert bestehende `AppError`-Instanzen unverändert; unbekannte Ausnahmen werden in `AppError` verpackt.

Das Rückgabeobjekt muss vor Zugriff auf `ui` oder `newState` auf `error` geprüft werden. Die Rückgabe von `analyzeMarket` hat dagegen einen Fehlertext. Nach einer Übertragung durch Worker ist außerdem dessen eigener Nachrichtenvertrag maßgeblich; eine Klassenidentität im Hauptthread darf nicht vorausgesetzt werden.

## Grenzen und Änderungen

Eine Engineaktion verändert kein reales Depot. [Balance](../docs/reference/BALANCE_MODULES_README.md) attribuiert den Haushaltsvorschlag, der [Simulator](../docs/reference/SIMULATOR_MODULES_README.md) führt ihn auf kopierten Lots aus. Tatsächliche Käufe und Verkäufe bestätigt ausschließlich [Personen & Vermögen](../docs/reference/TRANCHEN_MODULES_README.md#depot-und-ausgeführte-verkäufe).

Ansparpfade im Simulator sind eine interne Kompatibilitätsgrenze. Die Engine-Jahresrechnung stellt keinen freigegebenen Ansparworkflow der Oberfläche bereit.

Quelländerungen gehören in diese Module. Generierter Wrapper und Buildregeln stehen in [TECHNICAL](../docs/reference/TECHNICAL.md#engine-wrapper). Fach-, API- und Workerprüfungen sowie Testbefehle stehen im [Test-README](../tests/README.md#schutzprüfungen). Bei einer Vertragsänderung müssen Balance, Simulator und Worker denselben Input- und Ergebnisvertrag verwenden.
