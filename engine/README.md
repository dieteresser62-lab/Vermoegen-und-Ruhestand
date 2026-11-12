# Engine-Module und Aufrufverträge

[engine/index.mjs](index.mjs) exportiert `EngineAPI` und `_internal_calculateModel`, zusätzlich gemeinsam als Default-Objekt. Die Engine berechnet einen Jahresvorschlag aus Eingaben und Vorjahresstate. Sie verwaltet weder DOM noch Profilpersistenz.

Die [Entscheidungsfolge](../docs/reference/TECHNICAL.md#engineaufruf) erklärt die Reihenfolge der Fachschritte. Das vollständige Entnahmeschema mit Parametern und Beispielen steht im [Rechenweg des Jahresbudgets](../docs/reference/JAHRESBUDGET.md). Weitere Modelle stehen im [Fachkonzept](../docs/reference/FACHKONZEPT.md), gespeicherte Records in den [Datenverträgen](../docs/reference/DATENVERTRAEGE.md). Wrapper, Globals und Auslieferung gehören zur [technischen Architektur](../docs/reference/TECHNICAL.md#engine-wrapper).

## Module

| Quelle | Zuständigkeit |
| --- | --- |
| [core.mjs](core.mjs) | Bisherige benannte Exporte und das gemeinsame Default-Objekt re-exportieren |
| [core/api.mjs](core/api.mjs) | Gemeinsames API- und Default-Objekt bereitstellen; Enginefehler abfangen |
| [core/annual-model.mjs](core/annual-model.mjs) | Jahresrechnung in bisheriger Reihenfolge koordinieren |
| [core/input-normalization.mjs](core/input-normalization.mjs) | Eingaben vor der Validierung normalisieren |
| [core/annual-needs.mjs](core/annual-needs.mjs) | Bedarf, Dynamic Flex und Wunschobergrenze berechnen |
| [core/vpw-return.mjs](core/vpw-return.mjs) | Entnahmerate, geglättete Rendite und Langlebigkeitsdiagnose berechnen |
| [core/vpw-safety.mjs](core/vpw-safety.mjs) | Sicherheitsstufe und Wiedereinstieg aus dem Vorjahresstate ableiten; Diagnose ergänzen |
| [core/action-validation.mjs](core/action-validation.mjs) | Geplante Quellen und Steuer vor dem Abschluss prüfen |
| [core/action-settlement.mjs](core/action-settlement.mjs) | Jahressteuer abschließen, Verwendungen prüfen und Aktion finalisieren |
| [core/action-source-tax.mjs](core/action-source-tax.mjs) | Finale Steuer auf Verkaufsquellen verteilen |
| [core/action-contracts.mjs](core/action-contracts.mjs) | Geplante und finale Aktionsflüsse abgleichen |
| [core/liquidity-runway.mjs](core/liquidity-runway.mjs) | Liquidität nach Transaktion, Deckung, Reichweite und deren Diagnose berechnen |
| [core/annual-result.mjs](core/annual-result.mjs) | UI-Ergebnis und Folgestate zusammensetzen |
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
| [planners/equity-cost.mjs](planners/equity-cost.mjs) | Aktienrendite nach Fondskosten (FR-76) für Simulator und Dynamic Flex |
| [planners/fixed-income-budget.mjs](planners/fixed-income-budget.mjs) | Gemeinsame FR-52-Einkommensgrenze, beschlossenen Einkommens-Flex und FR-57-Ansparjahr bestimmen |
| [planners/spending-diagnosis.mjs](planners/spending-diagnosis.mjs), [flex-trace.mjs](planners/flex-trace.mjs) | Diagnose und optionalen Flex-Trace aufbereiten |
| [transactions/TransactionEngine.mjs](transactions/TransactionEngine.mjs) | Transaktionsfunktionen bündeln |
| [transactions/transaction-utils.mjs](transactions/transaction-utils.mjs) | Liquiditätsziel, Handelsgrenzen und Quantisierung berechnen |
| [transactions/transaction-action.mjs](transactions/transaction-action.mjs) | Auffüllung, Verkauf oder keine Aktion wählen |
| [transactions/transaction-opportunistic.mjs](transactions/transaction-opportunistic.mjs), [transaction-surplus.mjs](transactions/transaction-surplus.mjs) | Opportunistische Auffüllung und Investition überschüssiger Liquidität prüfen |
| [transactions/sale-engine.mjs](transactions/sale-engine.mjs) | Verkaufsquellen und steuerliche Rohwerte bestimmen |
| [transactions/net-action.mjs](transactions/net-action.mjs) | Gegenläufige Aufträge verrechnen, Restverkäufe mit vorhandenem Verlustvortrag neu versteuern; bei ungedeckter Steuer den ursprünglichen Auftrag über `netActionEntriesOrOriginal` erhalten |
| [transactions/three-bucket-logic.mjs](transactions/three-bucket-logic.mjs) | Anleiheersatz und Auffüllung im Drei-Topf-Modus finalisieren |
| [tax-settlement.mjs](tax-settlement.mjs) | Einzel- oder gemeinsame Jahressteuer und nächste Verlustvorträge berechnen |
| [errors.mjs](errors.mjs) | `AppError`, `ValidationError` und `FinancialCalculationError` definieren |

In FR-52-Überschussjahren setzt der Core `isSavingsYear` aus `decidedFixedIncomeSurplus`. FR-57 investiert freie Liquidität über der Reserve ab 500 €, auch im Bärenmarkt und bei Rentenüberschüssen. `trySurplusRebalance` füllt zuerst das Goldziel und kauft für den Rest Aktien; Sparplankäufe werden auf Cent abgerundet. Ohne Kennung bleiben Marktsperre, Mindesthandel und Handelsrundung erhalten. Bei drei Töpfen verteilt die Finalisierung nach FR-63 die freigegebene Tagesgeldanlage zuerst auf die Anleihenlücke. Sie verkauft bei unterschrittenem realem Renditeauslöser, tatsächlicher Anleihenentnahme für die Auszahlung oder gleichzeitigem Aktienkauf keine Aktien zur Auffüllung. `bondPayoutProtection` bezeichnet den tatsächlich verbleibenden Anleihenverkauf, auch nach Puffer-Schutz. Bei leerem Anleihentopf entfällt dieses Merkmal; `recovery_in_bear` allein sperrt keine Auffüllung.

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
| Vermögen | `tagesgeld`, `geldmarktEtf`, `depotwertAlt`, `depotwertNeu`, optional `anleihenWert`, `goldWert`, Kostenbasis und Detailtranchen |
| Person und Einkommen | `aktuellesAlter`, `startAlter`, `renteAktiv`, `renteMonatlich`, `sparerPauschbetrag`, `kirchensteuerSatz` |
| Markt | `inflation`, `endeVJ`, `endeVJ_1`, `endeVJ_2`, `endeVJ_3`, `ath`, `jahreSeitAth`, `capeRatio` bzw. `marketCapeRatio` |
| Liquidität | `liquidityRunwayYears`, `minCashBufferMonths`, Abschöpfungs-/Refillgrenzen nur für Verkäufe; Überschusskäufe nach Ziel, Auszahlung plus Netto-Grundbedarfsmonat, Mindesthandel und Marktlage; optional `aktuelleLiquiditaet`, `lockedHealthBucketAmount`, `plannedExpenseLiquidityReserve` |
| Gold | `goldAktiv`, Ziel- und Floorquote, `rebalancingBand`, Steuerannahme |
| Dynamic Flex | `dynamicFlex`, `horizonYears`, `horizonMethod`, `survivalQuantile`, Go-Go- und Langlebigkeitswerte, `returnPolicy`, `equityCostPct` (Fondskosten, fehlend = 0) |
| Drei Töpfe | `decumulation.mode`, `bondTargetFactor`, `drawdownTrigger`, `bondRefillThreshold` |

`plannedExpenseLiquidityReserve` ist optional, endlich und nicht negativ. Balance übergibt die noch offenen geplanten Ausgaben des Planjahres. Core addiert sie nach der Budgetentscheidung zum regulären Liquiditätsziel. Bei einem Fehlbetrag finanziert die Transaktionsplanung das volle Ziel ohne Mindesthandel oder Skim-/Drip-Cap, bei Drei Töpfen nötigenfalls auch aus Aktien im Bärenjahr. Budget, Alarm, Kürzungsgrund und Entnahmequote verwenden weiter die bisherige Basis. Fehlt der Wert, bleibt das vollständige Ergebnis unverändert.

`anleihenWert` ist eine endliche, nichtnegative Teilmenge von `depotwertNeu`. Nur die Renditeprognose für Dynamic Flex zieht diesen Wert von der Aktiengewichtung ab und zählt ihn zu den sicheren Anlagen (`SAFE_ASSET_REAL_RETURN`). Gesamtvermögen, Transaktionen, Steuern und Quoten verwenden weiter den vollständigen Neubestand. Fehlt das Feld, bleibt die bisherige Rechnung erhalten. Die Aufrufer übergeben Tagesgeld, Geldmarkt und Detailtranchen bereits ohne gesperrte Pflege-Rücklage.

`lockedHealthBucketAmount` ist der endliche, nichtnegative, aktuell gesperrte Nominalbetrag. Er gehört nicht zum aktiven Vermögen. FR-35 verschiebt den realen Höchststand um `peakLockedHealthBucketReal − lockedHealthBucketAmount / cumulativeInflationFactor`, mindestens auf 0. Danach wird die aktuelle reale Rücklage als neue Basis gespeichert. Altstände ohne Feld verwenden 0; ohne Rücklage entsteht kein neues Zustandsfeld. Balance und Simulator übergeben dieselbe Basis, nach vollständiger Pflegenutzung 0.

Das Liquiditätsziel beträgt Reichweite × max(geplante Jahresauszahlung, Grundbedarf + Wunsch-Flex − Jahresrente, 0), mit bestehendem Mindestpuffer und Rundung. Der Simulator kann bei Pflege `careLiquidityProjection` mit Floor, Flex, Einkommen und Preisverhältnis des Folgejahrs übergeben. Dann ersetzt die volle Folgejahresbasis die laufende Basis; zusätzlich beschlossener Flex bleibt mit Folgejahrespreisen gedeckt. Ohne dieses Feld bleibt die Berechnung unverändert. Kürzungen senken das Ziel nicht. Höhere Auszahlungen durch Dynamic Flex oder Go-Go erhöhen es entsprechend. Die tatsächliche Entnahme bleibt die Basis der operativen Reichweite. Bei Entnahmequoten bis 2,5 % lockert `RATE_CHANGE_RELAX_MAX_UP_PP` den Anstieg einer rückständigen Flex-Rate auf bis zu 20 Prozentpunkte pro Jahr. Das entspricht dem Höchstschritt beim Senken und holt 40–50 Prozentpunkte in etwa zwei bis drei Jahren auf, soweit Sicherheitsgrenzen es zulassen. Die Schwelle liegt in der Mitte der bisherigen Vermögensdämpfung von 1,5 bis 3,5 %. Go-Go gilt nur bis einschließlich Alter 80 der ältesten lebenden Haushaltsperson und bleibt an Sicherheitsstufe 0 gebunden. Nach einem Todesfall setzt der Simulator dafür `goGoAge`; `aktuellesAlter` läuft unverändert weiter. Bei einer endlichen Zahl verwendet die Engine dieses Go-Go-Alter, sonst wie bisher das Maximum aus `aktuellesAlter` und `partnerAlter`. Balance setzt das optionale Feld nicht.

Die Flex-S-Kurve schützt bei höchstens `FLEX_SHARE_MIN_PROTECTED_WITHDRAWAL_RATE` (2 %) den inflationierten Wunsch-Flex nach Abzug der Überschussrente. Den Mehrbetrag aus Dynamic Flex oder Go-Go begrenzt sie weiterhin. `evaluateProtectedPortfolioWithdrawal` in `minimum-flex-policy.mjs` berechnet dafür die geschützte offene Depotentnahme: Netto-Grundbedarf plus durch Rentenüberschuss noch nicht gedeckter Mindest-Flex, geteilt durch das aktive Gesamtvermögen. FR-20 verwendet dagegen die tatsächliche geplante Auszahlung nach allen normalen Regeln einschließlich Rundung. Der Glättungsanker bewahrt die Rate vor Rundung; die Notlagenausnahme bleibt erhalten. Core reicht `staticFlexBaseline` vor der dynamischen Neuberechnung an den Planner weiter. Bis einschließlich 2 % verwendet die S-Kurve `max(S-Kurven-Cap, staticFlexBaseline / inflatedBedarf.flex × 100)` als Obergrenze. Ohne dynamischen Mehrbetrag bleibt die Rate dadurch unbegrenzt; oberhalb von 2 % gilt der bisherige Cap. Alarm, Sicherheitsstufen, Glättung und andere Obergrenzen bleiben wirksam.

Nach FR-60 reicht das Anhebungsziel des Budget-Floors höchstens bis zu Jahreseinkünften plus 4,5 % des Depots. Höhere Policy-Auszahlungen bleiben erhalten.

Der Kürzungsgrund stammt aus dem größten senkenden Ratenschritt der gesamten Rechnung einschließlich Rundung. Anhebungen wie der Budget-Floor zählen nicht. Diese Auswahl läuft auch ohne gespeicherten Flex-Trace; Momentaufnahmen entstehen nur bei angeforderter Diagnose. Ohne Kürzung gegenüber Wunsch-Flex oder bei einer Rate ab 100 % bleibt die Kürzungsanmerkung leer. Begrenzt die S-Kurve den dynamischen Mehrbetrag, nennt die Anmerkung diesen Eingriff auch bei finanziertem Wunsch-Flex. Trace und Warum-Treppe nennen ebenfalls die S-Kurve.

Die Verkaufsroutine löst Teilverkäufe mit der Steuer auf den tatsächlichen Teilgewinn; der feste restliche Pauschbetrag bleibt vollständig verfügbar. Bei gleichen Steuer- und Gewinnquoten entscheidet das ältere Kaufdatum. Ein explizites Bruttoziel behält Vorrang vor dem Nettoauftrag.

`settleHouseholdTaxYear(rows, jointAssessment)` in `tax-settlement.mjs` ergänzt die Einzelabrechnung. Bei genau zwei Personen und eingeschalteter Zusammenveranlagung verrechnet es Verluste vor dem Vortrag sowie ungenutzte Pauschbeträge nach deren eigener Nutzung. Balanceattribution und Simulatorjahresbücher rufen denselben Baustein auf. Aus und Einzelperson verwenden unverändert `settleTaxYear`.

Core kopiert und normalisiert den Input. Einige fehlende Vermögenswerte werden zu `0`, Alter erhält einen Standardwert. Das ersetzt keine vollständige Eingabeprüfung im Aufrufer. `floorBedarf` und `flexBedarf` müssen endliche, nicht negative Zahlen sein; für eine aktive Rente gilt das auch für `renteMonatlich`.

Nach FR-40 hat der verbleibende Haushalt nach Tod in Pflege keine eigene Flex-Obergrenze. FR-26 begrenzt den Flex wie bei allen Haushalten auf zweimal den aktuellen Wunsch-Flex, auch bei VPW-Sicherheitsboden und Wiedereinstieg. Der Rentenüberschuss verbraucht denselben Rahmen wie der Depotanteil. Die anteiligen Sterbejahreswerte liefert weiterhin der Simulator.

`minimumFlexAnnual` ist ein nominales Jahresziel. Fehlt es oder ist es leer, verwendet Core `0`. Sonst wird es numerisch konvertiert und anschließend validiert: endlich, nicht negativ, höchstens `flexBedarf`. Zu große Werte werden zurückgewiesen und nicht still begrenzt.

`aktuelleLiquiditaet` überschreibt bei ausdrücklicher Angabe die Summe aus Tagesgeld und Geldmarkt. Dieser Wert muss bereits eine endliche, nicht negative Zahl sein. Eine fehlende Angabe verwendet die Summe. Die Reichweite ist kanonisch `liquidityRunwayYears`; Core entfernt die alten Felder `runwayMinMonths`, `runwayTargetMonths` und `targetEq` aus dem normalisierten Input. Die Feldprüfung verlangt 1 bis 10 Jahre in Halbjahren.

C4/C5 begrenzen den Netto-Auffüllauftrag und stellen ein gemeinsames Aktien-Bruttobudget einschließlich maximaler Kapitalertragsteuer bereit. Die Verkaufsroutine nutzt darin ihre normale Steuerreihenfolge statt eines festen Alt-/Neu-Mixes. Bei Gold über dem Band lautet die Quellenfolge Gold, Anleihen, Aktien; die Bandprüfung verwendet ebenfalls `aktuelleLiquiditaet`. Rechenweg und verbleibende Grenzen stehen in [C4/C5](../docs/reference/HANDLUNGSANWEISUNG.md#c4) und [C10/C11](../docs/reference/HANDLUNGSANWEISUNG.md#c10).

Ein positiver `capeRatio` hat bei der Normalisierung Vorrang vor `marketCapeRatio`. Wenn beide Felder vorliegen, prüft der Validator beide. `decumulation` wird auf `standard` oder `3_bucket_jilge` normalisiert; weitere alte Modusnamen sind Kompatibilitätseingaben.

`finalizeThreeBucketAction: true` finalisiert bei `3_bucket_jilge` die vollständige Jahresaktion vor dem Steuerabschluss; Balance und Simulator setzen diese Option. Unverheiratete Simulatorhaushalte finalisieren nach der Budgetentscheidung mit den persönlichen Liquiditätsreserven. [net-action.mjs](transactions/net-action.mjs) verrechnet anschließend Verkäufe und Käufe derselben Person und Anlageklasse vor der Buchung. Ein schlechtes Jahr wird an Kursrendite minus Inflation gemessen. Auch bei einer geplanten Ausgabe bleiben Aktien für den normalen Bedarf geschützt. Nach Liquidität und Anleihen darf nur der noch offene Anteil der zusätzlichen Ausgabe aus Aktien kommen. Reguläre und persönliche Auszahlungen nutzen die verfügbare Liquidität und danach die übliche Quellenfolge mit Anleihen. Die vollständige Umschichtung wird vor der Auszahlung geplant: Geplante Anleihenverkäufe mindern den Bestand. Freigegebene Tagesgeldanlagen füllen zuerst die Anleihenlücke, danach Gold und Aktien. Eine Auffüllung aus Aktien entfällt bei `bondPayoutProtection`, unterschrittenem realem Renditeauslöser, Anleihenverkauf oder gleichzeitigem Aktienkauf. Der Bären-Guardrail kennzeichnet die marktbedingte Auszahlung ausdrücklich; ohne diesen Auftrag darf auch eine Erholung den Anleihentopf auffüllen. Der zusätzliche Aktienverkauf nutzt nur den noch freien Sparerpauschbetrag; sein Bruttobetrag wahrt die Aktienreserve. Reicht der Aktienbestand nicht, bleibt die Auffüllung begrenzt. Ein über das Kaufziel hinausgehender Nettoerlös fließt in Liquidität.

`lastState` ist der explizite zweite Parameter. Er trägt unter anderem die Inflations-, Flex-, Budget-, Safety- und Steueranker. Core liest den Verlustvortrag daraus und liefert den nächsten unter `newState.taxState`. Die Engine speichert diesen State nicht. Balance entscheidet über den bestätigten Jahreswrite; Simulator und Worker reichen den State innerhalb ihres eigenen Pfads weiter. Aufrufer müssen einen passenden Vorjahresstate liefern, nicht das Ergebnis einer beliebigen Vorschau.

`SpendingPlanner` kopiert den Folgestate ohne das interne `keyParams`-Feld. Diagnose und Entnahmedetails kopieren dessen eigene Felder in derselben Reihenfolge; die Policy setzt ergänzende Felder mit benannten Zuweisungen. So vermeiden jährliche Kopien V8s Wörterbuchmodus und generischen Spread-Pfad. Rechenfolge, öffentliche Werte und Feldreihenfolge bleiben erhalten. [Monte-Carlo-Laufzeit](../docs/reference/TECHNICAL.md#monte-carlo-laufzeit) beschreibt die getrennte Messung und die privaten Tranchenkopien an der Simulatorgrenze.

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

`ui.vpw` bleibt auch bei deaktiviertem Dynamic Flex vorhanden. Die Diagnose unterscheidet eine gewünschte Aktivierung von einer durch Safety unterdrückten Aktivierung. Bei greifender fester Obergrenze ergänzt `ui.vpw` die Felder `wishFlexCapApplied`, `wishFlexCapAnnual` und bei aktiver VPW-Berechnung `dynamicFlexBeforeWishCap`. Der Rahmen beträgt zweimal `flexBedarf`, einschließlich Rentenanteil. Mindest-Flex-Ziel, finanzierter Flex und begrenzende Policy stehen im Spendingresultat. Deren Bedeutung und FR-6-Auswertung führt das [Fachkonzept](../docs/reference/FACHKONZEPT.md).

Der normale Steuerabschluss steht in `ui.action.taxSettlement`, der resultierende Verlustvortrag in `newState.taxState`. `deferTaxSettlement: true` unterstützt eine nachgelagerte Finalisierung, etwa für die Haushaltsattribution. Ein aufgeschobener Abschluss ist kein fertig abgerechneter Simulatorjahresvorschlag.

Im Drei-Topf-Pfad bleibt ein gerundeter Mehrerlös aus einem Anleihenverkauf in der Liquidität. Bei Mindererlös werden die Verwendungen anteilig gekürzt.

Core prüft die geplante Entnahme und die Quellen-/Verwendungsflüsse. Inkonsistente Aktionen erzeugen `FinancialCalculationError` mit Vertragskontext. Aufrufer dürfen eine fehlerhafte Aktion nicht durch null oder einen Zahlungsunfähigkeitsfall ersetzen.

### Optionaler Flex-Trace

Der dritte Parameter `{ includeFlexTrace: true }` schaltet `ui.spending.flexTrace` zu. Ohne diese Option wird kein Collector erzeugt. Balance fordert ihn für die lesende Diagnose an; die Rechenpfade für Monte Carlo, Sweep, Backtest und Replay brauchen ihn nicht.

Der Trace hält die tatsächlich durchlaufenen Flex-Schritte und deren Monatswirkung als eingefrorene Einträge fest. Nicht endliche Diagnosezahlen werden zu `null`. Entnahme, Aktion und Folgestate bleiben durch die Option unverändert. Reihenfolge und Diagnoseanschlüsse stehen in der [Entscheidungsreferenz](../docs/reference/TECHNICAL.md#engineaufruf). Im Guardrails-Schritt meldet `budgetFloorBegrenzt` eine bindende Begrenzung des Kaufkraftziels nach FR-60. `budgetFloorGesperrt` gilt nur, wenn dadurch gar nicht angehoben wurde. Die bestehende Diagnose `cautionBudgetFloor.details.budgetFloorBlocked` bezeichnet weiterhin beide Fälle; die Vorsichtskarte zeigt dann „Löst aus“. Der Trace gehört nicht in persistierte States oder Ergebnisexporte.

### Fehlerresultate

`ValidationError.errors` enthält Feldfehler mit `fieldId` und `message`. `FinancialCalculationError.context` trägt den verletzten Vertrag und Rechenwerte. `AppError` ergänzt Kontext und Zeitstempel. `simulateSingleYear` fängt Ausnahmen, protokolliert sie und liefert bestehende `AppError`-Instanzen unverändert; unbekannte Ausnahmen werden in `AppError` verpackt.

Das Rückgabeobjekt muss vor Zugriff auf `ui` oder `newState` auf `error` geprüft werden. Die Rückgabe von `analyzeMarket` hat dagegen einen Fehlertext. Nach einer Übertragung durch Worker ist außerdem dessen eigener Nachrichtenvertrag maßgeblich; eine Klassenidentität im Hauptthread darf nicht vorausgesetzt werden.

## Grenzen und Änderungen

Eine Engineaktion verändert kein reales Depot. [Balance](../docs/reference/TECHNICAL.md#balance-und-abschluss) attribuiert den Haushaltsvorschlag, der [Simulator](../docs/reference/TECHNICAL.md#simulator-und-worker) führt ihn auf kopierten Lots aus. Tatsächliche Käufe und Verkäufe bestätigt ausschließlich [Personen & Vermögen](../docs/reference/TECHNICAL.md#personen-und-depot).

Ansparpfade im Simulator sind eine interne Kompatibilitätsgrenze. Die Engine-Jahresrechnung stellt keinen freigegebenen Ansparworkflow der Oberfläche bereit.

Quelländerungen gehören in diese Module. Generierter Wrapper und Buildregeln stehen in [TECHNICAL](../docs/reference/TECHNICAL.md#engine-wrapper). Fach-, API- und Workerprüfungen sowie Testbefehle stehen im [Test-README](../tests/README.md#schutzprüfungen). Bei einer Vertragsänderung müssen Balance, Simulator und Worker denselben Input- und Ergebnisvertrag verwenden.
