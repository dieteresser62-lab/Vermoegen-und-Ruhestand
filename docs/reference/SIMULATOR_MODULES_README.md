# Simulator-App – Modulübersicht

## Übersichtseinstiege (Paket 6, Slice 2)

`simulator-main.js` wertet nach erfolgreicher UI-/Enginebereitschaft die
festen Hashes `#backtest`, `#monte-carlo`, `#annahmen` und `#werkstatt`
über `parseOverviewTarget` und `openSimulatorOverviewTarget` aus.
Der Adapter ruft ausschließlich `activateSimulatorTab` mit den bestehenden
Tabnamen auf. Unbekannte Ziele, Zusatzparameter und blockierte oder fehlgeschlagene
Initialisierung lösen keine Sprungaktion aus. Der vorhandene einmalige
Startbacktest bleibt erhalten; die Linkauswertung startet keinen zweiten Lauf
und keine automatische Monte-Carlo-Rechnung.

Die Simulator-App ist inzwischen in mehrere spezialisierte ES6-Module zerlegt. Die zentralen Abläufe (Monte-Carlo, Sweep, Backtests, Pflege-UI) leben nicht mehr als Monolith in `simulator-main.js`, sondern wurden in klar abgegrenzte Dateien ausgelagert. Dieses Dokument beschreibt Zweck, Haupt-Exports, Einbindungspunkte und die gewünschte Aufteilung neuer Features.

**Stand:** 2026-10-06 (einschliesslich offener globaler
Aktien-Forschungsproxykette, Langlebigkeit, Stationary Bootstrap,
Tail-Risk-Overlay, Realentnahmevertrag, getrennter Pflege-KPI-Semantik,
vollstaendigem historischen Backtest-Contract, SimulationDataInventoryV1
sowie verlustfreier Profilasset-/Goldzielaggregation und technisch
nachgebesserter, extern noch nicht freigegebener Slice-17-Runway-Semantik
sowie intern validierter, extern noch nicht freigegebener wahrheitsgetreuer
Risikoanzeigen und des Monte-Carlo-Ergebnis-Cockpits)

**Pfadkonvention:** Simulator-Module liegen unter `app/simulator/`, Profilmodule unter `app/profile/`, Shared-Utilities unter `app/shared/`, Tranchen-Status unter `app/tranches/`. Im Dokument werden Dateinamen aus Lesbarkeit meist ohne Präfix genannt.

---

## 1. `simulator-main.js` (Fassade)
UI-Orchestrierung und Klammer um die ausgelagerten Feature-Module. Registriert Event-Handler, lädt/persistiert Eingaben und ruft die spezialisierten Startpunkte auf.

**Hauptaufgaben / Exporte:**
- `initializeSimulatorApp()` – UI-Bootstrap: verbindet Buttons mit `runMonteCarlo`, `runBacktest`, `runParameterSweep`, setzt Debug-Toggles, lädt letzte Detailstufe für Logs.
- Weiterleitung der Kern-Handler: Buttons und Hotkeys rufen direkt Funktionen aus `simulator-monte-carlo.js`, `simulator-backtest.js` und `simulator-sweep.js` auf.
- Drehscheibe für gemeinsame Hilfsfunktionen (`simulator-main-helpers.js`) und Shared-Kontext (`WORST_LOG_DETAIL_KEY` aus `simulator-results.js`).

**Einbindung:** Wird von `Simulator.html` geladen und importiert alle übrigen Simulator-Module. Neue UI-Buttons sollten hier mit dem passenden Fachmodul verdrahtet werden.

**Helper-Module (ausgelagert):**
- `simulator-main-init.js` – Bootstrapping & Orchestrierung
- `simulator-assumptions-ui.js` – fünf unabhängige Annahmenklappen,
  Detailzugang, Füllstatus und Segmentdarstellung bestehender Selects. Aufklappen
  verändert weder Eingabewerte noch Persistenz. Der Füllstatus ignoriert hidden,
  Checkboxen, disabled, Leerwerte und 0; Profilübernahme aktualisiert ihn explizit.
- `simulator-auto-backtest.js` – dokumentbezogener einmaliger DOM-Start sowie
  Öffnungsrechnung nach den bestehenden Persistenz-/Profil-/Initialisierungs-,
  Recovery-, Engine-, Daten- und Eingabebarrieren; zwei Frames vor synchroner Rechnung.
- `simulator-main-input-persist.js` – Persistenz + Start-Portfolio-Refresh
- `simulator-household-needs-persistence.js` – strikter V1-Vertrag fuer manuelle Haushalts-Overrides von Floor, Flex und Mindest-Flex; einmalige `sim_`-Altwertuebernahme, feldbezogene Provenienz, Reset-Marker und kontrollierter Fallback
- `simulator-main-rent-adjust.js` – Rentenanpassungs-UI
- `simulator-main-accumulation.js` – stillgelegte UI-Modulgrenze ohne Listener oder Speicherwirkung
- `simulator-main-sweep-ui.js` – Sweep-UI + Grid-Size
- `simulator-workshop-ui.js` – drei dauerhaft sichtbare Auswahlkarten, aktive Messingtönung, genau eine bestehende Arbeitsfläche darunter und Schließen auf der Karte mit Rückfokus; `selectWorkshopTool()` erhält Hosts/Arbeitsstände, `openWorkshopReplay()` aktiviert den Hauptreiter ohne Controllerneuanlage; Werkstatt-Infofenster mit gemeinsamen `ds-info`-Rollen
- `simulator-main-tabs.js` – idempotente Hauptreiterbindung und `activateSimulatorTab()`; Reihenfolge Ergebnis, Annahmen, Backtest, Monte-Carlo, Werkstatt
- `simulator-main-profiles.js` – Profilverbund-Auswahl
- `simulator-input-validation.js` – DOM-freie Validierung gemeinsamer Simulator-Inputs, aktuell `minimumFlexAnnual <= startFlexBedarf` sowie Tail-Risk-Parameter und Horizont-Kompatibilitaet
- `simulator-main-reset.js` – Reset-Button
- `simulator-main-stress.js` – Stress-Preset-Select
- `simulator-main-partner.js` – Partner-UI Toggle
- `simulator-main-sweep-selftest.js` – Sweep-Selbsttest (Dev)

### Ergebnisoberfläche und Öffnungsbereitschaft (Paket 4, Slice 1)

`simulator-main.js` wartet Persistenz und `whenProfilePageReady()` ab; danach beendet `initializeSimulatorApp()` auch Profil-/Haushaltsübernahme und Trancheninitialisierung. Der Öffnungslauf prüft Recovery zusätzlich zur aufgelösten Profilbereitschaft. Neue Module:

- `simulator-auto-backtest.js`: `startAutomaticBacktest()` ist durch eine WeakMap dokumentbezogen einmalig und für synthetische Tests injizierbar. `automaticBacktestPeriod()` liest Providergrenzen, beschränkt auf das Vorjahr und benennt fehlende Jahre. Der Provider prüft Lookback und innere Lücken; es gibt keinen Ersatzdatensatz. Zwei `requestAnimationFrame`-Callbacks aus `nextPaintFrame()` geben dem Laufzustand vor dem synchronen Runner einen gezeichneten Frame.
- `simulator-result-overview.js`: reine Projektionen `projectBacktestOverview()` und `projectMonteCarloOverview()`, Ergebnisdarstellung, Popupbindung und Revisionsbeobachtung. Start/Abschluss kommen aus den bestehenden UI-Adaptern nach Validierung, nicht aus Engine oder Worker. Karte, Chart und Krisen teilen das kanonische Backtestresultat.
- `simulator-crises.js`: `portfolioChartPoint()`, `backtestChartSeries()` und `deriveHistoricalCrises()` lesen Jahreszeilen ohne Reserve. Dotcom, Finanzkrise, Corona und Zinswende werden auf die Periode begrenzt; Ruin beendet die Serie. Minimum und Liquidität stammen aus derselben Zeile, Gleichstand nimmt das erste Jahr. Referenz ist Vorjahr oder `portfolioStart` minus kanonischem `health_bucket_start`; bei fehlender/Nullreferenz fehlt die Prozentangabe. Haushalts-Flex-Basis und -Kürzung bestimmen die Zählung ab einschließlich 10 %; Anspar-/BANKRUPT-Zeilen zählen nicht.
- `simulator-run-assumptions.js`: getrennte Laufköpfe, genaue strukturierte wirksame Werte und Revisionsansprüche nur im Arbeitsspeicher. Rückänderungen entfernen den Hinweis; ausgeblendete UI-Details erzeugen keine Revision. MC berücksichtigt Methode, Runs, Horizont, Seed, Sampling, Stress und Tail-Risk zusätzlich. Ein gescheiterter/abgebrochener Ersatz erhält den letzten erfolgreichen MC-Inhalt; verspätete Tokens werden abgewiesen.

Bei einer wirksamen Haushaltsauswahländerung ruft `simulator-main-profiles.js` sofort `invalidateBacktestForHousehold()` auf, noch vor dem Planinitialisierer und unabhängig von gültigen Personendaten. Das frühe Signal `simulator:household-changing` ersetzt in `simulator-result-overview.js` die Kontextrevision und markiert die Projektionen veraltet. Es sperrt Ersatzläufe bis zum bestehenden Signal `simulator:household-applied` nach vollständiger gültiger Inputübernahme. Abgelehnte oder wirkungslose Auswahlversuche invalidieren nicht. Dieser verwirft `window.globalBacktestData`, Summary, Jahreslog, Portfoliochart, Protokollpersonenbeleg, Cohorts, Hinweise und den bisherigen Perioden-/Erfolgsstatus; JSON und CSV sind sofort gesperrt. Detailwechsel und erneute UI-Initialisierung können den Altbestand nicht wiederherstellen. Ein ausstehender, wegen Personendaten/Recovery gesperrter oder technisch fehlgeschlagener Ersatz bleibt ohne aktuelle Backtestquelle; gemeldete Vorbereitungs-, Sperr- und Fehlerphasen werden auch im Backtest-Reiter angezeigt. In der Übersicht darf der bisherige Lauf weiter sichtbar bleiben, aber Urteil, Beträge, Chart, Krisen und Personenlaufkopf sind ausdrücklich als veraltet gekennzeichnet. Haushaltsrevision und Laufgeneration weisen überholte Vorbereitung und verspätete Summary-Ablage ab. Mehrere Auswahlwechsel während einer offenen Vorbereitung führen zu einem Ersatz für die neueste Auswahl, auch nach Rückkehr zu denselben Zahlen; unwirksame Wiederholungen erhalten das aktuelle Resultat. Erst ein erfolgreicher Ersatz veröffentlicht eine gemeinsame immutable Quelle für Summary, Tabelle, Chart und Exporte mit den aktuellen Profil-IDs. Die neuen Veraltetkennzeichnungen gelten ausschließlich bei einer Abweichung von `metadata.householdContextRevision` zur aktuellen `contextRevision`. Gewöhnliche Annahmenänderungen erhalten das bisherige Erfolgs-/Ruinurteil und den Hinweis „Annahmen seitdem geändert“; eine Rückänderung entfernt diesen Hinweis nach dem bisherigen Wertevergleich. Rechen- und Exportschemata ändern sich nicht.
- `simulator-workshop-ui.js`: Werkzeugwahl zwischen den erhaltenen Hosts `#workshopReplayPanel`, `#tab-sweep` und `#tab-auto-optimize` innerhalb `#tab-werkstatt`; nur Sichtbarkeit und Fokus. Die Hosts sind keine Hauptpanels mehr. `openWorkshopReplay()` öffnet denselben Replayhost aus Logs und Controller einschließlich Fokus; der MC-Rückweg aktiviert Haupttab und Logs. Kein neuer Controller oder Ergebnisbestand.

Die Ergebnis-Neuberechnung verwendet den aktuellen Backtestzeitraum, ohne Cohorts. Auch nach ungültigen Eingaben, fehlenden Daten oder einem technischen Fehler kann eine wirklich neue wirksame Revision einmal rechnen; die fehlgeschlagene Revision wird nicht automatisch wiederholt. Manuelle Backtests behalten die ausgewählte Cohortoption. `simulator-portfolio-chart.js` verwendet für echte Backtestzeilen Kalenderjahre, dynamische Euroeinheiten und Krisenbänder. Das SVG misst beim Rendern die Hostbreite, mindestens 820 px, und erhält diese native Breite für den 14-px-Token; schmale Karten scrollen lokal. Druck überschreibt diese Bildschirmbreite passend zur Seite. Rechenschemata, Exportschemata, Parser und Speicherkeys bleiben unverändert. Weitere Gestaltung der Bestandsflächen und externe Browser-/Bildabnahme sind offen.

### Annahmen und Ergebnisgestaltung (Paket 4b, Fortsetzungsslice 1)

Die fünf Annahmenkarten verwenden die bestehenden Eingaben mit unveränderten IDs:
Profile und Startportfolio; Floor/Flex/Mindest-Flex und CAPE; Strategie mit
Dynamic-Flex-, Go-Go-, Langlebigkeits-, 3-Bucket- und Rebalancingdetails; Personen,
Steuer, Partner und Hinterbliebene; Pflege mit allen fünf Pflegegraden.
„Alle Parameter zeigen“ öffnet verfügbare Details, keine fachlichen Aktivierungen. Klappen mit null weiteren bedienbaren Controls werden verborgen und bei Freigabe wieder gezeigt; Werte und Öffnungszustand bleiben erhalten. Partnerrollen bleiben unzerlegt; Dynamic Flex nutzt die volle Kartenbreite mit einzeiligen Segmentbeschriftungen. Native Partner-/Pflege-/Cohort-/Protokollcheckboxen stehen unmittelbar vor dem Slider; der auf 1 px abgeschnittene Input überlagert die Zeile nicht. Dynamische Feldgründe stehen außerhalb des Labels, erhalten ihre ARIA-Zuordnung und unterbrechen die Input-/Slidernachbarschaft nicht. Die Pflegereserve und ihr Erhaltungssatz liegen klein und ungerahmt direkt in der Pflegelogik-Schalterzeile. Nicht
anwendbare Partnerbereiche bleiben mit Gründen bei ihren bisherigen
Controllern; ausgeblendete Legacy-Rentenbrücken sind keine unabhängigen Eingaben.
Profilübernahme erhält primäre Person und vorhandene Sperren; die historische Zwei-Profil-Auswahlgrenze gilt vor der Planumstellung.
Pflege aus sperrt die Details; Wiedereinschalten erhält Kosten-/Flex-/Mortalitätswerte.
Der Reset am Ende zeigt Titel und Satz links, den bisherigen Knopf rechts; schmale Ansichten stapeln die Zeile. Schutz, Bestätigung, Flush und Reload bleiben beim bisherigen Besitzer.

Ein gemeinsamer Kontext-/Aktionshost und die einzige Hauptreiterleiste folgen
dem sichtbaren Seitenkopf. Kanonische Laufmetadaten unterscheiden Öffnung,
automatische Revision und manuellen Backtest. Ergebnisreserve und Startbetrag
kommen aus dem tatsächlichen Backtest; ohne Lauf wird kein Betrag erfunden.
Die drei Backtestkennzahlen teilen Label- und Wertzeilen; der Kürzungsseriensatz steht klein ohne Hinweisbox unter seinem Wert. Der Portfolioverlauf nutzt die volle Kartenbreite und erhält seine Daten, native SVG-Breite und horizontalen Scrollschutz. Fehlende Laufdauer und ein nicht zuverlässig definierter Standardabweichungszähler
werden weggelassen. Externe Browserursachenmessung, zehn Grundbedienungsfälle
sowie Bildvergleich 01–09 bei 1920/2560 px sind noch offen.

Für einen bestätigten Bereich liefert `household_plan_v1` Bedarf, Mindest-Flex,
Krisenbudget, Reichweite, Strategie, Dynamik, Horizont, Go-Go, Langlebigkeit und
CAPE genau einmal. `household-plan.js` besitzt Bereichsauswahl, Validierung,
Formularpatch und Projektion. `initInputPersistence()` lädt Planwerte und bindet
auch Reichweite, Abschöpfen und Bärenmarkt-Auffüllen. `simulator-plan-trial.js`
besitzt den flüchtigen Entwurf; Normalzustand ist lesend. Formularereignisse und
Dynamic-Flex-Presets aktualisieren ausschließlich diesen Besitzer. Unsichtbare
Mindest-Liquidität und Haushaltsentnahmemodus kommen aus dem aktuellen Plan.
Nur die bestätigte Übernahme schreibt über `patchHouseholdPlan()`; Initialisierung
und reine Darstellungswechsel schreiben keinen Plan.

Vor Umstellung oder bei „Später“ bleibt der bisherige additive Profildefault mit
feldweisen `household_simulator_needs_v1`-Overrides aktiv. Erst dort gelten die
Legacy-Trio-Migration, Warnquittierung und Zukunftsschemasperre. Nach Bestätigung
werden diese Altquellen nicht gelesen; ein beschädigter Altdatensatz blockiert
keinen validierten Plan. Reset löscht keinen gemeinsamen Plan. Mehr als zwei
bestätigte Mitglieder bleiben im Plan-/Vermögensumfang erhalten; die bestehende
Demografiebegrenzung auf zwei Personen wird weiterhin als Warnung ausgewiesen.
Ohne Auswahl wird der eigene Plan der geöffneten Person verwendet; ihr Außenbereich
bleibt von Haushaltswrites unberührt. Ein Mitgliedschaftswechsel führt die
bereichsweise Umstellung vor der erneuten Inputübernahme aus.


---

## 2. `simulator-monte-carlo.js`
Koordiniert die Monte-Carlo-Simulation und verbindet DOM-Interaktion mit der reinen Simulationslogik.

**Hauptfunktionen / Exporte:**
- `runMonteCarlo()` – startet genau einen generationengebundenen Lauf, liest UI-Parameter, orchestriert `monte-carlo-runner.js` und Web-Worker-Jobs, aktualisiert Progress/UI und publiziert nach dem Lauf den versionierten V1-JSON-Download (Default: 8 Worker, 500 ms Job-Budget). Doppelte Starts liefern dasselbe laufende Promise.
- `cancelMonteCarlo()` – ist single-flight, schaltet die UI auf `cancelling`, terminiert die für die aktive Generation arbeitenden Worker und verhindert einen seriellen Fallback. Das Promise umfasst Workerende, Handlerabschluss und asynchrones UI-Cleanup.
- `runMonteCarloSerial()` – Signaladapter für den UI-Pfad: nutzt denselben einzelnen `runMonteCarloChunk` und dieselbe Aggregation wie `runMonteCarloSimulation`, reicht aber das Abbruchsignal bis in den Chunk weiter. Der vorhandene DOM-freie Runnervertrag bleibt erhalten; feste Seeds liefern identische fachliche Ergebnisse.
- Validiert vor dem Start, dass `Mindest-Flex p.a.` den `Flex-Bedarf p.a.` nicht uebersteigt, optionale Tail-Risk-Parameter innerhalb des freigegebenen Contracts liegen und `MonteCarloParametersV1` samt Worker-/Budgetvertrag erfuellt ist. Grosslaeufe ueber 100.000 bis maximal 1.000.000 Runs benoetigen eine pro Start verbrauchte Bestaetigung.

**Navigationsschutz:** Der einmal pro Dokument registrierte Besitzer `simulator-monte-carlo` meldet `preparing`, `running` und `cancelling` mit Generation und Revision. Erst nach vollständigem Cleanup wird er idle. Während eines Navigationsversuchs sind neue Starts abgewehrt. Erfolgreiche Ergebnisdarstellung registriert einen eigenen Verlustgrund; Download und abgebrochene Folgeläufe quittieren ihn nicht. Ein Erstlaufabbruch erzeugt kein Ergebnis. Signalprüfungen nach Vorbereitung, Workerinit, Rechnung und Log-Replay verhindern späte Fortschritte, Exporte und Ergebnispublikation. Auch der serielle Vergleichspfad erhält das Signal.

**Einbindung:** Wird von `simulator-main.js` importiert und im UI-Bootstrap an den Start-Button (`#mcButton`) gekoppelt. Die Laufzeitbindung des Cancel-Buttons (`#mcCancelButton`) erfolgt ueber die UI-Fassade. Alle Monte-Carlo-spezifischen Anpassungen sollten hier erfolgen, damit `simulator-main.js` schlank bleibt.

**Dependencies:** `monte-carlo-runner.js`, `monte-carlo-ui.js`, `monte-carlo-contracts.js`, `monte-carlo-export.js`, `scenario-analyzer.js`, `simulator-portfolio.js`, `simulator-results.js`, `simulator-sweep-utils.js`, `simulator-utils.js`, `simulator-data.js`, `cape-utils.js`.

---

## 3. `monte-carlo-runner.js`
DOM-freie Simulation, die alle Runs, KPI-Arrays, Pflegemetriken und Pflegebucket-Metriken berechnet.

**Hauptfunktionen / Exporte:**
- `runMonteCarloSimulation()` – Führt die komplette Simulation aus, sammelt Worst-Run-Logs, Pflege-KPIs, Pflegebucket-KPIs und aggregierte Kennzahlen.
- Verarbeitet die `isRuin`-Rückgabe des direkten Jahreslaufs und den
  Ansparphase-Übergang. Davon getrennt markiert die Ergebnisaggregation einen
  fehlgeschlagenen Lauf oder Aktien-plus-Gold von höchstens 100 Euro als
  Depoterschöpfung; freie Liquidität und Pflegebucket gehören nicht zu dieser
  Teilmetrik.
- Aggregiert zusätzlich `taxSavedByLossCarry` (gesamt und pro Run), damit Steuerersparnis aus Verlustvorträgen auswertbar bleibt.
- Wendet optional das Tail-Risk-Overlay nicht-mutierend auf gezogene Jahresdaten an; die Schedule ist an den absoluten `runIdx` und den per-run Seed gekoppelt.
- Ermittelt ab der ersten Dekumulationsverpflichtung genau einen realen Depotentnahme-P10-Skalar je Run. Bei Ruin werden weitere Verpflichtungsjahre bis Tod oder Horizont ohne zusaetzliche Marktziehungen mit 0 Euro erfasst.

**Einbindung:** Wird ausschließlich aus `simulator-monte-carlo.js` aufgerufen. Erwartet fertige Eingaben und Callbacks (Progress, Szenario-Analyzer) und nutzt `simulator-engine-wrapper.js` (delegiert an Direct Engine) für die Jahr-für-Jahr-Logik.

**Dependencies:** `mc-run-context.js`, `mc-year-sampling.js`, `mc-life-events.js`, `mc-stress-tracker.js`, `mc-log-builder.js`, `mc-run-metrics.js`, `simulator-engine-wrapper.js`, `simulator-portfolio.js`, `simulator-health-bucket.js`, `simulator-results.js` (Portfolio-Helpers), `simulator-sweep-utils.js`, `simulator-utils.js`, `simulator-data.js`.

## 3g. `tail-risk-contract.js` und `tail-risk-overlay.js`
DOM-freier Contract und Overlay fuer seltene Fat-Tail-/Crash-Ereignisse in Monte Carlo.

**Hauptfunktionen / Exporte:**
- `normalizeTailRiskConfig()` – normalisiert Opt-in und Parametergrenzen ohne stilles Klemmen ungueltiger User-Werte.
- `validateTailRiskHorizonCompatibility()` – blockiert Ereignisdauern, die den Simulationshorizont ueberschreiten.
- `createTailRiskSchedule()` – erzeugt deterministische Ereignisfenster aus Run-Seed, Wahrscheinlichkeit, Dauer und Cooldown.
- `applyTailRiskOverlay()` – erzeugt effektive Jahresdaten ohne Mutation der historischen Quelle und skippt historische Krisenjahre.

**Einbindung:** `simulator-portfolio-inputs.js` liest die UI-Felder und nutzt den Contract, `simulator-input-validation.js` blockiert ungueltige Werte, `monte-carlo-runner.js` wendet das Overlay im Jahresloop an, `mc-run-metrics.js` und `monte-carlo-aggregates.js` liefern `extraKPI.tailRisk`.

## 3a. `mc-run-context.js`
DOM-freie Chunk-Kontext-Erzeugung fuer den Monte-Carlo-Runner.

**Hauptfunktionen / Exporte:**
- `createMonteCarloRunContext()` – bereitet RunRange, RNG-Modus, Legacy-RNG, Stress-Master, Buffers, Progress-Intervall, LogIndexSet und Sampling-Konfiguration vor.

**Einbindung:** Wird von `monte-carlo-runner.js` vor der Run-Schleife genutzt. Sampling-Algorithmen bleiben im Runner, damit der erste Refactoring-Slice keine Startjahr-Logik verschiebt.

## 3b. `mc-year-sampling.js`
DOM-freie Startjahr- und CAPE-Sampling-Logik fuer Monte-Carlo.

**Hauptfunktionen / Exporte:**
- `buildStartYearCdf()` / `pickStartYearIndex()` – CDF-Aufbau und deterministische Startjahrwahl fuer FILTER/RECENCY/UNIFORM.
- `buildYearSamplingConfig()` – gewichtete Sampling-Konfiguration fuer Startjahr und laufende Jahresdaten.
- `resolveMonteCarloSamplingContractV1()` / `pickMonteCarloStartYearIndex()` – versionierte Praezedenzaufloesung und per-Run-Auswahl inklusive CAPE-Kandidaten, methodenspezifischer Jahr-1-Regel sowie Preflight fuer harte Regime- und historische Stresspools.
- `createMonteCarloSamplingDiagnosticsV1()` / `recordMonteCarloSampledYearV1()` / `mergeMonteCarloSamplingDiagnosticsV1()` – kompakte Startjahr-, Jahres-, Quellen-, Regime-, Stationary- und Tail-Risk-Zaehler mit Datenfingerprints.

**Einbindung:** Wird von `mc-run-context.js` fuer die Basiskonfiguration, vom Runner fuer die einmalige Vertragsaufloesung und Startjahrwahl sowie vom Chunkresultat fuer Validierung und reihenfolgeunabhaengiges Merge genutzt.

## 3c. `mc-life-events.js`
DOM-freie Life-State-Initialisierung fuer Monte-Carlo.

**Hauptfunktionen / Exporte:**
- `createMonteCarloLifeState()` – erzeugt Care-Meta, Partnerstatus, Care-RNGs, Alive-Initialwerte und HouseholdContext fuer einen Run.
- `updateMonteCarloLifeEventsForYear()` – testbarer Jahresupdate-Helper fuer Pflege-/Sterblichkeitslogik; im produktiven Runner wird die Jahreslogik aktuell aus Performance-Gruenden weiterhin lokal im Hot Path ausgefuehrt.

**Einbindung:** `monte-carlo-runner.js` nutzt die State-Initialisierung vor der Jahresschleife. Der erzeugte `householdContext.care`-Block transportiert `careMetaP1` und `careMetaP2` fuer Pflegebucket-Trigger ohne Signaturaenderung von `simulateOneYear()`. Weitere Life-Events-Extraktion muss den Monte-Carlo-Benchmark bestehen.

## 3d. `mc-stress-tracker.js`
DOM-freie Stress-Metrik-Kapselung fuer Monte-Carlo.

**Hauptfunktionen / Exporte:**
- `createMonteCarloStressTracker()` – initialisiert Stress-Jahre, Portfolio-Serie, Cut-Year-Zaehler, Real-Withdrawal-Liste und Recovery-Status.
- `recordMonteCarloStressYear()` – schreibt pro Simulationsjahr nur bei aktivem Stress die Stress-Metriken fort; Ansparjahre gehen nicht in die reale Depotentnahme ein.
- `recordMonteCarloStressZeroWithdrawal()` – ergaenzt nach Ruin Nullentnahmen nur innerhalb des festen Stressfensters.
- `writeMonteCarloStressMetrics()` – schreibt die bestehenden Stress-Buffer (`stress_maxDrawdowns`, `stress_timeQuoteAbove45`, `stress_cutYears`, `stress_CaR_P10_Real`, `stress_recoveryYears`).

**Einbindung:** Wird von `monte-carlo-runner.js` pro Run initialisiert und nach erfolgreichem Jahreslauf, bei der Nullauffuellung nach Ruin sowie beim finalen Buffer-Schreiben genutzt. Der V1-Path-Summary transportiert P10, Beobachtungszahl und Missingness indexiert je Run.

## 3e. `mc-log-builder.js`
DOM-freie Logzeilen-Builder fuer Monte-Carlo.

**Hauptfunktionen / Exporte:**
- `buildMonteCarloRuinLogRow()` – baut die Ruin-Logzeile mit stabilen Legacy-, Alive- und Care-Feldern.
- `buildMonteCarloYearLogRow()` – erweitert normale Jahres-Logdaten um Alive-, Care-, VPW- und Payout-Erklaerfelder.
- `buildMonteCarloDeathLogRow()` – baut den finalen Todesfall-Logeintrag inklusive Portfolio-Snapshot.

**Einbindung:** Wird von `monte-carlo-runner.js` nur bei aktivem `currentRunLog` genutzt. Feldnamen und Worst-Run-/CSV-kompatible Shapes bleiben stabil. Entnahme-/Payout-/VPW-Felder werden additiv transportiert und im UI nur bei detailliertem Log sichtbar gemacht.

## 3f. `mc-run-metrics.js`
DOM-freie Run-Ende-Metrikfortschreibung fuer Monte-Carlo.

**Hauptfunktionen / Exporte:**
- `createMonteCarloCareNeedTracker()` / `recordMonteCarloCareNeedYear()` – summieren den modellierten P1-/P2-Zusatzbedarf pro Run nominal und real zur Preisbasis des Simulationsstarts; gleichzeitiger Bedarf ist die Jahressumme P1 plus P2.
- `createMonteCarloRunMetrics()` – initialisiert getrennte P1-/P2-/Haushaltslisten, Worst-Run-Container, `runMeta` und globale Zaehler.
- `recordMonteCarloRunOutcome()` – schreibt pro Run getrennte Pflegeeintritte und -jahre ohne Null-Sentinels, reale Pflege-Mehrbedarfe, Pflegebucket-Nutzung/Erschoepfung, Safety-Run-Zaehler, Worst-Run-Auswahl und `runMeta` fort.
- `finalizeMonteCarloRunMetrics()` – baut `totals`, `lists`, Worst-Runs, `allRealWithdrawalsSample` und `runMeta` inklusive P1-/P2-, Pflegebucket- und Tail-Risk-Zaehlern fuer die Chunk-Rueckgabe.

**Einbindung:** Wird von `monte-carlo-runner.js` im Jahresloop und am Run-Ende genutzt. Der V1-Path-Summary-Contract traegt reale und explizit mit `NominalEur` benannte nominale Pflegefelder; eine kausale Depotkosten-Zurechnung wird nicht behauptet.

## 3h. `monte-carlo-statistics.js`
Reine Statistikhelfer fuer Monte-Carlo-Anteils- und Quantilschaetzer.

**Hauptfunktionen / Exporte:**
- `calculateWilson95Interval()` – berechnet das Wilson-95-Prozent-Intervall fuer einen binaeren Anteil einschliesslich der Randfaelle `0/n` und `n/n`.
- `buildBinaryProportionEstimate()` – liefert Punktschaetzer, Zaehler, Nenner, Runzahl, Intervall und eine sichtbare Klein-Stichproben-Warnung unter 1.000 Runs; technische Batchfehler unterdruecken Schaetzer und Intervall fail-closed.
- `summarizePerRunRealWithdrawalP10()` – aggregiert genau einen realen Depotentnahme-P10-Skalar je auswertbarem Run und liefert P10, P50, Stichprobengroesse sowie Missingness-Inventar. Ein Konfidenzintervall fuer das Quantil wird nicht behauptet.

**Einbindung:** `monte-carlo-chunk-result.js` baut den Floor-Schaetzer, `monte-carlo-aggregates.js` aggregiert die global indexierten Per-Run-Skalare und `results-metrics.js` projiziert Interpretation, Stichprobengroesse und Warnungen.

## 3i. `monte-carlo-contracts.js` und `monte-carlo-export.js`
DOM-freier, versionierter Raw-Vertrag fuer einen vollstaendigen Monte-Carlo-Lauf.

**Hauptfunktionen / Exporte:**
- `createMonteCarloRunRequestV1()` / `validateMonteCarloRunRequestV1()` – normalisieren und validieren Seed, Methoden, Szenario, Datenfingerprint, Worker-/Chunkkonfiguration und Snapshotpolicy; lokale Pfade, Secret-Felder und nicht endliche Zahlen werden abgewiesen.
- `createMonteCarloRunResultV1()` / `validateMonteCarloRunResultV1()` – erhalten den historischen Ergebnisvertrag fuer Reproduzierbarkeit und Replay.
- `createMonteCarloRunResultV2()` / `projectMonteCarloRunResultV2()` / `validateMonteCarloRunResultV2()` – projizieren Outcome-Inventar, Heatmap-Intervalle, explizite Ratio-/Prozentpunktsemantik, Observation-Counts sowie nominalen und realen Maximum-Drawdown fail-closed in den aktuellen Exportvertrag.
- `extractMonteCarloReplayArgsV1()` – rekonstruiert die DOM-freien Runnerargumente fuer einen deterministischen Re-Run.
- `buildMonteCarloExportV2()` / `readMonteCarloExport()` / `createMonteCarloExportDownload()` – schreiben den aktuellen `MonteCarloExportV2` mit SHA-256-Runfingerprint, App-/Engineprovenienz und sicherem Dateinamen. V2 besitzt den expliziten Bezeichner `MONTE_CARLO_EXPORT_V2_VERSION`; der deprecated unqualifizierte Altbezeichner behaelt seine historische V1-Bedeutung. Der Dispatcher liest V1 nur mit Kompatibilitaetswarnung, V2 direkt und weist unbekannte Versionen fail-closed ab. `buildMonteCarloExportV1()` / `readMonteCarloExportV1()` bleiben fuer historische Artefakte erhalten.
- `projectScenarioLogV2()` / `serializeScenarioLogExportV2()` / `serializeScenarioLogCsvV2()` – bilden den gemeinsamen semantischen Projektor fuer Szenario-JSON und -CSV. `ScenarioLogExportV2` typisiert Finanz- und Terminalrecords, trennt Ratio- von Prozentpunktfeldern sowie Post-Policy- von Erfuellungswerten und erzeugt den CSV-Header aus der sortierten Vereinigungsmenge aller Recordschluessel. Akkumulationsjahre markieren Entnahme- und Mindest-Flex-Gruppen als nicht anwendbar, ohne beobachtete Returns zu verwerfen.

**Snapshotlinie:** `MonteCarloSnapshotPolicyV1` trennt die unveraenderliche
Referenz `pre-hardening-v1`, versionierte semantische Post-Slice-Referenzen
und den extern noch nicht freigegebenen Integrationskandidaten
`monte-carlo-v1-final`. Solange kein extern freigegebener Nachfolger
vorliegt, ist die oeffentliche `currentReference` `null`;
`post-backtest-data-07-v1` ist der neueste getrennte, bis zum erneuten
externen Review `pending` markierte Demografie-/Pflege-/Hinterbliebenen-
Messkandidat auf Basis von `post-backtest-data-06-v2`. Der
veraenderliche Zeiger wird aus der eingefrorenen Ergebnisprojektion
ausgeschlossen. Pending Kandidaten werden daher weder zur aktuellen Referenz
erklaert noch wegen einer reinen Zeigeraenderung dupliziert. Fruehere Suite-
und Backtest-Datenreferenzen werden nicht ueberschrieben. Fixture-spezifische
Vergleichsausnahmen stehen nur in der Messfixture, nie im produktiven
Runtimevertrag. Unerklaerte Deltas blockieren die Fortschreibung.

**Einbindung:** `simulator-monte-carlo.js` erzeugt Request und internes Resultat direkt aus den tatsaechlich verwendeten Laufdaten. `monte-carlo-ui.js` stellt den MC-Download erst danach bereit; die V2-Projektion erfolgt an der Exportgrenze. `simulator-results.js` verwendet fuer Szenario-JSON und -CSV denselben V2-Projektor. Es gibt keine automatische Persistenz oder Uebertragung.

---

## 3j. `monte-carlo-parameters.js`
DOM-freier Eingangs- und Ressourcenvertrag fuer alle Monte-Carlo-Consumer.

**Hauptfunktionen / Exporte:**
- `normalizeMonteCarloParametersV1()` – validiert ganze, endliche Werte ohne Suffixe, alle erlaubten Enums und Booleans sowie Run-, Mortalitaetshorizont-, Block-, Seed- und Startjahrabhaengigkeiten; Default sind 10.000 Runs.
- `normalizeMonteCarloResourceConfigV1()` / `resolveMonteCarloWorkerCountV1()` – validieren 0=auto beziehungsweise 1-32 Worker und 50-5.000 ms Jobbudget; auch die Hardware-Automatik endet bei 32 Workern.
- `estimateMonteCarloResourcesV1()` – liefert Run-Jahre, eine auf 978 gerundeten Result-Bytes je Run basierende MiB-Schaetzung (Standardmessung Slice 11: 977,62585 Byte je Run), Speicherklasse, Belastungsstufe und das Bestaetigungsflag oberhalb 100.000 Runs.

**Einbindung:** `monte-carlo-ui.js`, `monte-carlo-runner.js`, `workers/mc-worker.js` und `auto-optimize-worker.js` rufen denselben Contract auf. Kein Consumer darf Parameter per `parseInt` teilakzeptieren oder fachliche Werte still begrenzen.

---

## 4. `monte-carlo-ui.js`
Kapselt DOM-Zugriffe für Monte-Carlo (semantische Progressbar, Live-Status, Fokus, Start-/Cancelzustand, Kostenschaetzung, Grosslastbestaetigung, Parameter-Inputs und expliziter V1-JSON-Download) und liefert eine UI-Fassade zurück.

**Hauptfunktionen / Exporte:**
- `createMonteCarloUI()` – erzeugt ein UI-Objekt mit Methoden fuer `running`/`cancelling`/`idle`, eine idempotent loesbare Cancelbindung, ARIA-Progress/Status, Fokusziele, Grosslastbestaetigung und `readUseCapeSampling()`.
- `readMonteCarloParameters()` – liest die Eingabefelder und delegiert ohne Teilparsing an `normalizeMonteCarloParametersV1()`.
- `initMonteCarloResourceControls()` – aktualisiert Run-Jahre/Speicherklasse ohne automatischen Lauf und verwirft eine Bestaetigung, sobald Runzahl oder Dauer geaendert wird.
- `triggerMonteCarloDownload()` – erzeugt Blob/Objekt-URL nur nach Buttonaktion, setzt den sicheren Dateinamen und raeumt die URL wieder auf.

**Einbindung:** Von `simulator-monte-carlo.js` genutzt. UI-bezogene Änderungen sollten hier gebündelt werden.

---

## 4a. `mc-result-cockpit.js`

Zentrale, rein darstellungsbezogene Zustandsgrenze fuer das Monte-Carlo-
Ergebnis-Cockpit. Sie gruppiert Setup, Laufkopf und Ergebnisnavigation, ohne
Monte-Carlo-, Replay-, Persistenz- oder Exportdaten zu veraendern.

**Hauptfunktionen / Exporte:**

- `initMonteCarloResultCockpit()` – initialisiert je Dokument genau einmal die
  Setup-Zusammenfassung, Recalculate-Delegation, vier ARIA-Tabs, Replay-
  Rueckverweise in beide Richtungen und die delegierten Vergleichstabs.
- `activateMonteCarloResultView()` – aktiviert eine Ergebnisansicht anhand
  ihrer View-ID oder eines enthaltenen Zielknotens. Alle programmatischen
  MC-Fokuspfade verwenden diese Grenze vor `focus()`; Replay verwendet `openWorkshopReplay()` und den bestehenden Haupttabadapter.
- `completeMonteCarloCockpitRun()` – aktualisiert nach Erfolg die
  Setup-Zusammenfassung und schliesst das Setup. Der aufrufende UI-Lifecycle
  aktiviert danach ueber `activateMonteCarloResultView()` den Ueberblick;
  Fehler und Abbruch schliessen das Setup nicht automatisch.
- `updateMonteCarloSetupSummary()` und
  `updateMonteCarloReplayVariantBadge()` – projizieren vorhandene Eingaben
  beziehungsweise die sichtbare Variantenliste am Werkstattanker `#mcReplayVariantBadge` rein visuell; sie sind keine
  zweite Validierungs- oder Persistenzquelle. Die drei Replay-Schrittzustaende
  leitet `updateStressReplayStepStates()` in `stress-replay-ui.js` aus
  Workspace, Banner und Fieldset ab.

**DOM- und Fokusvertrag:** Die Cockpit-Navigation verwendet ausschließlich
`.mc-view-*` und kollidiert nicht mit den fünf Haupttabs. Inaktive Panels sind
am Bildschirm `hidden`; der Roving-Tabindex unterstuetzt Links/Rechts sowie
Home/End. `#scenarioSelector` bleibt ein einziger stabiler Knoten in der
Ansicht „Szenario-Logs“ direkt vor `#scenarioLogOutput`.
`displayMonteCarloResults()` bindet dessen Gruppen und Listbox neu und projiziert
dieselbe Auswahl lesend in Replay-Schritt 1. Der Rückweg öffnet die Auswahl und
fokussiert die aktuelle Option über `focusSelectedScenario()`.
Die Rueckverweise zwischen Logs und Replay sowie asynchrone Replay-Abschluesse
aktivieren vor dem Fokus die jeweilige sichtbare Ansicht. Das Setup bleibt ein
natives `details`; der separate `#mcSettingsToggle` synchronisiert „Einstellungen
ändern“/„Einstellungen ausblenden“ und `aria-expanded` mit dessen Offenzustand.
Der eingeklappte kanonische `#mcButton` ist kein Erfolgs-
Fokusziel; „Neu rechnen“ delegiert lediglich seinen Klick.

**Responsive-/Druckvertrag:** Bis 899 CSS-Pixel stapeln Variantenliste und
Editor; lokale Tabellen duerfen horizontal scrollen, die Seite selbst nicht.
Im Druck macht `simulator.css` Setup, alle vier MC-Panels, Replay-Details und
alle drei Vergleichssektionen sichtbar, entfernt Navigation und Sticky-
Verhalten und hebt abschneidende Hoehen-/Overflow-Grenzen auf. Der einzige
`#print-footer` steht am Ende des MC-Bereichs; JavaScript fuehrt keinen
separaten Druckzustand.

---

## 5. `scenario-analyzer.js`
Sammelt und sortiert Szenarien (Worst, Perzentile, Pflege, Zufalls-Samples) während der Simulation.

**Hauptfunktionen / Exporte:**
- `ScenarioAnalyzer` – Klasse mit `trackScenario()`/`buildScenarioLogs()`, die Metadaten und Logzeilen fuer charakteristische und zufaellige Szenarien zurueckliefert. Pflegefaelle werden nach fruehestem P1-/P2-Eintritt und hoechstem realen Mehrbedarf getrennt ausgewaehlt.

**Einbindung:** Von `simulator-monte-carlo.js` instanziiert und als Callback an den Runner übergeben.

## 5a. Stress-Pfad-Replay

Das Stress-Pfad-Replay fixiert den exogenen Verlauf eines ausgewaehlten
`per-run-seed`-Monte-Carlo-Runs. Der normale Batch bleibt unveraendert; nur der
explizite serielle Nachlauf fordert fuer den absoluten Run-Index einen
`StressReplayCaptureV1` an. Direkter und workerartig gesplitteter Chunk liefern
fuer denselben absoluten Index identische Log- und Capture-Daten.

**DOM-freie Module:**

- `stress-replay-contract.js` – Schemas, kanonische SHA-256-Fingerprints,
  Whitelist, Varianten-/Workspace-/Vergleichsvalidierung und Groessenlimits.
  Persistierte Varianten dispatchen ueber ihre `whitelistVersion`: V1 bleibt
  unveraendert, V2 ergaenzt `startFloorBedarf`, `startFlexBedarf` und
  `minimumFlexAnnual`. Ein explizites `0` bleibt ein Patchblatt; nur
  wirkungsgleiche Blaetter werden nach der Praesenzpruefung entfernt. Die
  effektive Relation `minimumFlexAnnual <= startFlexBedarf` wird mit Baseline-
  Fallback fail-closed validiert und niemals geklemmt.
  `maxSkimPctOfEq` gilt nur von 0 bis 50, `maxBearRefillPctOfEq` nur von 0 bis
  70; nicht endliche und ausserhalb liegende Werte werden nicht geklemmt. Neue
  Workspaces verwenden `StressReplaySourceIdentityV2`: Struktur und
  Feldpraesenz bleiben exakt, Geld- und Verhaeltniswerte werden nach Reload mit
  denselben Pfadtoleranzen wie die Originalzeilen abgeglichen. Die je Quellzeile
  vorhandenen Reconciliation-Werte sind als kanonische Praesenz-/Werteliste
  kompakt kodiert und durch Descriptor-, Identity- und Workspace-Fingerprints
  gebunden.
- `stress-replay-path-materializer.js` – Quellidentitaet, ScenarioLog-Abgleich,
  vollstaendiger Markt-/Household-Pfad und unabhaengiger Post-Ruin-Shadow-Seed.
  Vor dem ersten Shadow-Jahr ist der kanonische Marktstatus des Ruinjahres
  genau einmal fortgeschrieben.
- `stress-replay-runner.js` – RNG-freier Single-Path-Lauf mit unveraenderter
  Baseline oder validiertem Strategiepatch; Ruin, Tod, Horizont und technischer
  Fehler bleiben getrennte Statuswerte. `ruin` und `all_dead` enden beide mit
  einer expliziten Terminalzeile; `terminal_death` ist kein Finanzjahr.
- `stress-replay-variant.js` – Baseline und maximal drei Alternativen. Erlaubt
  sind nur bestehende Strategieparameter sowie in V2 die drei Ausgangsbedarfe;
  Asset-, Profil- und Tranchenwerte bleiben fixiert. Neue Varianten werden als
  V2 erzeugt, geladene V1-Varianten behalten ihre alten Regeln und Fingerprints.
- `stress-replay-transactions.js` und `stress-replay-comparison.js` – additive
  Transaktionsklassen mit belegten Simulator-Producern, explizite Missingness
  fuer unbekannte Event- und Breakdown-Werte, KPI-Deltas und erste
  Delta-Marker. Mehr-Faktor-Varianten werden sichtbar benannt; ein allgemeines
  Finanzranking und eine Asset-Allokations-Gegenfaktik sind ausgeschlossen.
- `stress-replay-persistence.js` und `stress-replay-export.js` – genau ein
  lokal transaktional gespeicherter Workspace mit Readback/Rollbackvertrag,
  bestaetigtes Ersetzen/Verwerfen, versionierter JSON-Roundtrip und Nur-Lesen-
  Modus bei Kompatibilitaetsabweichung. Die unabhaengig aus den originalen
  ScenarioLog-Zeilen gebildete Herkunftsidentitaet bleibt bei Reload und Import
  erhalten. V1-Herkunftsidentitaeten bleiben byte- und fingerprintstabil
  lesbar, liefern aber `source_identity_refix_required` und werden nicht
  automatisch migriert oder ausgefuehrt. V2 speichert und exportiert fuer den
  gebundenen Source-Praefix die tatsaechlich vorhandenen Reconciliation-Werte
  je Zeile (unter anderem Vermoegen, Renten, Flex-Erfuellung und
  Jahresentnahme), nicht nur einen Hash. Die Privacy-Ausschlussliste bleibt
  konsistent: vollstaendige Source-Scenario-Logs, lokale Dateipfade, Secrets
  und unbeteiligte Speicherrecords werden nicht exportiert. Der Export enthaelt
  dennoch Finanzdaten und ist vertraulich zu behandeln. Der aktive Key
  `sim.stressReplay.active.v1` wird nicht in allgemeine Snapshots aufgenommen.

**UI-Module:** `stress-replay-ui.js` steuert Sitzung, Fixieren, Varianten und
Import/Export; `stress-replay-renderer.js` rendert Patchvorschau, KPIs,
Delta-Timeline und Jahrestabelle. Der fokussierte Editor zeigt Name, Floor,
Flex und Mindest-Flex; die 17 bisherigen Felder liegen in einem initial
geschlossenen, nativen Experten-Disclosure. Leere Bedarfsfelder bedeuten
Baselineuebernahme, `0` bedeutet explizite Null. Statuscopy, Fokus und
Live-Regionen machen deutlich, dass alle Aussagen nur fuer den fixierten Pfad
gelten. Der Zustand `idle | success | error` trennt den neutralen Leerzustand
vom dauerhaften, alert-semantischen Vergleichsfehler. Mutationsmeldungen
behaupten einen Vergleichserfolg nur bei einem tatsaechlich erzeugten
Vergleich. Ein
controllerweiter Busy-Zustand sperrt Fixieren, Variantenmutationen,
Neuberechnung, Import, Export und Verwerfen gegen Parallelaufrufe. KPI-Deltas
verwenden eigene Einheiten fuer Jahre und Prozentpunkte statt der Formatter
der absoluten KPI-Werte. Die drei Vergleichssektionen werden bei jedem
Rendererlauf neu erzeugt und ueber delegierte Kennzahlen-/Delta-/Jahres-Tabs
umgeschaltet. Eine vorangestellte Kernaussage waehlt je vergleichbarer
Alternative hoechstens die erste endliche, materielle Abweichung nach der
festen Prioritaet Mindest-Flex-Luecke, Ruinjahr, reales Endvermoegen,
nominales Endvermoegen. Sie sortiert nicht, empfiehlt keine Strategie und
berechnet keine neue Metrik.

**Performancevertrag:** Der End-to-End-Test misst Baseline plus eine
Alternative auf einem materialisierten 60-Jahres-Pfad. Die eingecheckte
Referenzmessung unter WSL2/Node 22 auf einem Ryzen 7 3700X betraegt 435,858 ms
Median bei fuenf Messungen nach zwei Warmups. Die historische Exportbaseline
umfasst 88.524 Byte; der aktuelle 60-Zeilen-V2-Referenzexport misst 109.472
Byte. Sein relatives Budget liegt bei 110.655 Byte (Faktor 1,25), also bleiben
1.183 Byte beziehungsweise rund 1,1 Prozent Reserve. Die Kompaktkodierung ist
deshalb Teil des Groessenvertrags. Jede Erweiterung von
`SOURCE_IDENTITY_V2_RECONCILIATION_FIELDS` muss den maximalen 60-Zeilen-Export
neu messen; verbleibende Reserve darf nicht vorausgesetzt werden. Das
Laufzeit-Regressionsbudget ist relativ (Faktor 4, mindestens 250 ms) und
priorisiert deterministische fachliche Paritaet vor einer unbelegten absoluten
Durchsatzforderung.

---

## 6. `simulator-sweep.js`
Sweep-spezifische Logik mit Guardrails für Partner:innen-Felder und Heatmap-Ausgabe.

**Hauptfunktionen / Exporte:**
- `runParameterSweep()` – startet genau eine Generation und liefert bei wiederholtem Start dasselbe Handlerpromise. Iteriert über Whitelist-Parameter, nutzt Worker-Jobs (Fallback seriell) und leitet Ergebnisse an die Heatmap weiter.
- `cancelParameterSweep()` – bricht die aktive Sweep-Generation ab, terminiert ihre Worker und stoppt den seriellen Pfad an der naechsten Yield-Grenze. Die UI meldet „Abgebrochen“ und gibt den Startknopf frei; ein Nutzerabbruch loest keinen seriellen Fallback aus. Wiederholte Abbrüche liefern dasselbe Promise, das Pool-Dispose und vollständigen Handlerabschluss umfasst.
- `displaySweepResults()` – rendert Sweep-KPIs und Statushinweise.
- `initSweepDefaultsWithLocalStorageFallback()` – lädt Sweep-Voreinstellungen und setzt Defaults.

**Navigationsschutz:** Besitzer `simulator-sweep` meldet Vorbereitung, Arbeit und Kündigung mit eindeutiger Generation. Sein Ergebnisgrund entsteht erst nach bestätigter gemeinsamer Publikation von Daten und Heatmap und bleibt bei Fehler/Abbruch eines Folgelaufs erhalten. Zusammen mit Monte Carlo wartet der gemeinsame Schutz auf sämtliche Abbruchpromises, bevor Profilübergabe und Flush beginnen. Neue Starts während eines Navigationsversuchs sind abgewehrt; nach beendeter Navigation/Abbruch ist ein Neustart möglich.

**Einbindung:** Button-Hooks in `initializeUI()` (Werkstatt / Parameter-Sweep). Nutzt `simulator-sweep-utils.js` für Whitelist/Clone-Logik und `simulator-heatmap.js` für das Rendering.

Das eigene UI-Feld `sweepRuns` verwendet standardmaessig 500 Simulationen je Kombination und ist unabhaengig vom Monte-Carlo-Laufzahlfeld `mcAnzahl`. `initSweepDefaultsWithLocalStorageFallback()` speichert die Sweep-Laufzahl unter `sim.sweep.runs` und stellt sie nach einem Neuladen wieder her. Ein leerer oder ungueltiger gespeicherter beziehungsweise eingegebener Wert wird nicht still auf 500 korrigiert; die Validierung verhindert damit den Start. Der nominelle Aufwand ergibt sich aus wirksamen Kombinationen × Sweep-Laeufen × maximaler Dauer in Jahren. Erst oberhalb von 5.000.000 Laufjahren muss der Nutzer den Start bestaetigen. Worker-Jobs und der serielle Runner liefern sichtbaren Zwischenfortschritt bereits innerhalb einer Kombination beziehungsweise eines Worker-Blocks. Neue Ergebnisse werden erst nach vollstaendiger Berechnung und erfolgreichem Heatmap-Rendering gemeinsam mit `window.sweepExecution` veroeffentlicht. Bis dahin zeigt der Fortschritt hoechstens 99 %, 100 % erst nach erfolgreichem Abschluss. Bei Fehler oder Abbruch bleibt ein altes vollstaendiges Ergebnis stehen; ohne Altresultat bleibt die Ergebnisansicht leer.

**Dependencies:** `monte-carlo-runner.js` (Mini-Läufe), `simulator-heatmap.js`, `simulator-results.js`, `simulator-sweep-utils.js`, `simulator-utils.js`, `simulator-data.js`.

**Interaktiver Parametervertrag:** Die Browseroberflaeche bietet genau sieben
Dimensionen mit geprueftem kanonischem Datenpfad
`sweepLiquidityRunwayYears`, `sweepGoldRebalancingBand`, `sweepMaxSkimPct`,
`sweepMaxBearRefillPct`, `sweepGoldTargetPct`, `sweepSurvivalQuantile` und
`sweepGoGoMultiplier`. Die ersten fuenf Felder zaehlen immer; `sweepSurvivalQuantile` zaehlt nur bei Dynamic Flex mit Horizontmethode `survival_quantile`, `sweepGoGoMultiplier` nur bei Dynamic Flex und Go-Go. Inaktive VPW-Ranges bleiben gespeichert, werden aber nicht als Override an den Runner gegeben. Lauf und Grid-Zaehler lesen dieselben aktiven Ranges; der Zaehler wird nach dem Persistenzladen und bei Strategie-/Presetwechsel aktualisiert und zeigt das 300er-Limit. Nur `horizonYears` bleibt fuer explizite
programmatische `SweepRequestV1`-Aufrufe verfuegbar, ist aber keine
interaktive Sweepdimension, weil die UI aktuarielle Horizonte verwendet.
Die Matrix prueft Zuordnung, Consumer und Provenienz; sie ist kein
eigenstaendiger Nachweis der KPI-Wirkung.

---

## 7. `simulator-sweep-utils.js` (~220 Zeilen)
Gemeinsame Helfer für Sweep, Rente-2-Schutz und Deep-Clones.

---

## 8. `sweep-runner.js`
DOM-freier Sweep-Runner für Worker-Jobs (Combos + RunRanges) mit deterministischer Seeding-Logik.

**Hauptfunktionen / Exporte:**
- `normalizeWidowOptions()` / `computeMarriageYearsCompleted()` – Abgleich von Hinterbliebenen-Optionen.
- `deepClone()` / `cloneStressContext()` – Side-Effect-freie Kopien für Sweep-Zellen.
- `setNested()` / `withNoLSWrites()` – Hilfsfunktionen für sichere Mutationen.
- Führt pro Run `taxSavedByLossCarry` mit, damit Sweep-Metriken auch den Verlusttopf-Effekt abbilden.

**Einbindung:** Genutzt von `simulator-sweep.js`, `simulator-main.js` (Renten-Invarianz-Checks) und `simulator-monte-carlo.js`.

**Dependencies:** keine externen Module, nur Standard-APIs.

---

## 8. Backtest-Module

### `historical-backtest-contract.js`

DOM-freier, im historischen Produktbacktest aktivierter Daten- und Jahrescontract. Er
validiert `HISTORICAL_DATA_MANIFEST`, seine geordneten, eindeutigen
Reihendiskontinuitaeten und den kanonischen SHA-256-Fingerprint einmal je
Revision/Hash, baut einen immutable Lookup von
`HistoricalYearRecordV1` und stellt Einzelpfad-/Cohort-Batch-Preflights bereit.
Jeder Record trennt ex-post `realized` von `decisionAsOf` und traegt
`sourceYear`, `asOfYear`, Einheit, Ableitung und Qualitaetsstatus. Die aktive
Konvention `realized_t_decision_t_minus_1_v1` verwendet realisierte Werte aus
`t`. CAPE traegt Beobachtungsjahr `t-1`, Beobachtungsmonat Dezember, As-of-Jahr
`t-1` und Entscheidungsjahr `t` getrennt; die unter `t` gespeicherte
Entscheidungsreihe wird ohne zweiten Lag konsumiert.

**Hauptfunktionen / Exporte:**
- `createHistoricalBacktestContractProvider()` – gecachter Datasetvalidator und immutable Provider mit abgeleiteten Bounds sowie `preparePeriod()`/`prepareBatch()`.
- `buildHistoricalYearRecord()` / `validateHistoricalYearRecord()` – V1-Builder und strukturierte Recordvalidierung.
- `validateHistoricalDataManifest()` / `computeHistoricalDatasetHash()` – Manifest- und kanonischer SHA-256-Vertrag.
- `HISTORICAL_TEMPORAL_CONVENTION_ID` – stabile ID der aktiven Backtest-Zeitachse.
- `HISTORICAL_ASSIGNMENT_INVENTORY_V1` – maschinenlesbarer Vergleich von Legacy-Backtest, aktivem Monte-Carlo-`annualData`, alternativem Builder und kanonischem D-01-Zielcontract.

**Einbindung:** `simulator-backtest.js` erzeugt einen gecachten Provider und
uebergibt ihn an den produktiven `historical-backtest-runner.js`. Monte Carlo,
Sweep und Worker importieren den Backtestcontract weiterhin nicht.

**Dependencies:** `simulator-data.js`; keine DOM-, Persistenz-, Engine- oder Worker-Abhaengigkeit.

### `historical-backtest-runner.js`

DOM-freier historischer Jahresrunner mit expliziten Dependencies. `runHistoricalBacktest()` akzeptiert normalisierte Inputs, `{ startYear, endYear }`, einen Historical-Data-Provider, additive Engineprovenienz sowie die injizierten Funktionen `simulateYear`, `initializePortfolio`, `computeAdjustmentPct`, `resolveHorizon` und `totalPortfolio`. Der Runner liest weder Browserglobals noch Persistenz.

Vor dem Lauf konsumiert der Runner genau einen vollstaendigen Provider-Preflight.
Er baut jedes `yearData` ausschliesslich aus validierten Records, uebernimmt die
initiale Vierjahres-Markthistorie aus dem Contract und gibt bei einer Luecke
`incomplete` zurueck, bevor die Jahresschleife beginnt. Request und Ergebnis
tragen Dataset-, Manifest-, Temporal-, Engine-Build- und Config-Provenienz.

`BacktestRunResultV1` ist tief eingefroren und enthaelt `BacktestRequestV1`, diskriminiertes Outcome, Warnungen/sichere Fehlerdaten, unverkuerzte `rows`, `requestedYears`, wirtschaftlich erfolgreiche `completedYears`, erste/letzte Laufjahre, kanonische Start-/Endportfolio-Snapshots, Historical-Year-Records, `HistoricalBacktestMetricsV3`, Summary sowie die Legacy-Aliase. Caller-Inputs, Partner-/Tranchenobjekte und historische Records werden vor dem Lauf in eigene Kopien ueberfuehrt; `undefined`, `Date`, `RegExp`, Prototypen und zyklische Referenzen bleiben dabei runnerintern erhalten.

### `historical-backtest-metrics.js`

DOM-freies Metrikwoerterbuch und reine Ableitung fuer das kanonische
`BacktestRunResultV1`.

**Hauptfunktionen / Exporte:**
- `HISTORICAL_BACKTEST_METRIC_DESCRIPTORS` – versionierte Definitionen fuer 29 Metriken mit Einheit, nominal/real-Basis, Aggregation, Nenner, Rundung, Missingness, Outcome-Regel und Rohquelle. V3 behaelt die V2-Trennung von Haushalts-Flexbedarf, Rentenueberschuss, Depot-Flex und erfuelltem Haushalts-Flex bei und bindet Runway-Minimum/-Stress an `after_transaction_before_payout`.
- `deriveHistoricalBacktestMetrics()` – leitet das unverkuerzte `HistoricalBacktestMetricsV3` aus Jahreszeilen und Outcome ab; Summary und Export konsumieren dieselben Werte ohne zweite Berechnung. Alle Entnahmezeilen muessen denselben Vor-Auszahlungs-Phasenvertrag tragen; `null` bei nicht anwendbarer Zieldeckung wird aus dem endlichen Nenner ausgeschlossen, eine fehlende oder falsche Phase invalidiert dagegen beide Runway-Aggregate. Terminale Ruinzeilen und Ansparzeilen gehoeren nicht zu diesem Nenner. Fuer historische Rohzeilen bleibt `entscheidung.kuerzungProzent` ein expliziter Fallback, falls die neue Haushalts-Kuerzungsquote fehlt.
- `FLEX_REDUCTION_THRESHOLD_PCT` / `FLEX_REDUCTION_OPERATOR` – gemeinsamer inklusiver `>= 10 %`-Vertrag fuer ID, Label, UI und Export.

### `historical-backtest-cohorts.js`

DOM-freier Diagnose-Runner fuer ueberlappende historische Fenster mit fester,
inklusiver Horizontlaenge (`end = start + horizon - 1`).

**Hauptfunktionen / Exporte:**
- `runHistoricalBacktestCohorts()` – bildet alle Kandidaten, konsumiert genau einen Provider-Batch-Preflight und startet je geeignetem Fenster denselben Single-Path-Runner mit unveraenderten Inputs und `yearIndex=0`.
- `HistoricalBacktestCohortsV1` – inventarisiert `completed`, `ruin`, `incomplete`, `technical_error`, `cancelled` und `insufficient_horizon`; Nullnenner bleiben `null`.
- Jeder Request und Descriptor kennzeichnet die Fenster als ueberlappende historische In-sample-Diagnose, nicht als unabhaengige Stichprobe oder Erfolgswahrscheinlichkeit.

### `historical-backtest-export.js`

DOM-freier, versionierter Exportadapter fuer genau eine kanonische `BacktestRunResultV1`-Instanz.

**Hauptfunktionen / Exporte:**
- `buildHistoricalBacktestRawExport()` / `serializeHistoricalBacktestJson()` – erzeugen `HistoricalBacktestExportV2` mit vollstaendigem Request-/Resultmanifest, inklusivem Periodenvertrag, echten JSON-Zahlen und optionalem Cohort-Inventar.
- `serializeHistoricalBacktestCsv()` – projiziert den 34-spaltigen `HistoricalBacktestCsvV2`-Vertrag mit fuehrender, Raw-JSON-identischer Run-ID ohne Displayformatter; Semikolon, Punktdezimalen, LF, leere Missingness und Formel-Injektionsschutz sind Teil des Contracts.
- `captureHistoricalBacktestEngineProvenance()` – erfasst Engine-API-/Build-ID, den explizit vor dem Lauf geladenen sauberen Source-Commit, kanonischen SHA-256-Config-Fingerprint und den von der Entnahmelogik konsumierten Quantisierungsvertrag zum Laufzeitpunkt.
- `createHistoricalBacktestDownload()` – liefert Dateiname, Inhalt, MIME-Typ und Fingerprint; schreibt oder uebertraegt selbst nichts.

Der Runner entfernt interne Portfolio-Snapshots bereits aus dem kanonischen Resultat; V2 liefert stattdessen nur gegen einen zweiten, von der primaeren Totalfunktion unabhaengigen Jahreszeilen-Rechenweg reconciliierte, explizit nicht restartfaehige `HistoricalBacktestPortfolioBoundariesV2`. Dessen `totalComposition` nennt aktives Portfolio plus Pflegebucket und markiert den separat sichtbaren Pflegebucket als bereits in Start-/Endvermoegen enthalten. Pflegebucketwerte sind in kanonischer Grenze, Jahreszeile, CSV und Drawdownreihe genau einmal enthalten. `HistoricalBacktestInputSemanticsV2` erklaert die Legacy-/Ableitungsfelder und bindet das Strategie-Liquiditaetsziel an `liquidityRunwayYears` plus die jahresspezifische, post-policy geplante Netto-Portfoliojahresentnahme. `RuntimeBuildProvenanceV1` wird vor dem Lauf ausschliesslich ueber den relativen Same-Origin-Endpunkt `./__build-provenance.json` geladen; der Export kann die dabei gebundene Provenienz nicht ersetzen, und Unterpfad-Auslieferungen bleiben funktionsfaehig. Fehlender/dirty Source-Commit, ein unvollstaendiger Quantisierungsvertrag oder widerspruechliche Portfolio-Grenzen stoppen Raw-JSON fail-closed mit sichtbarem Fehlercode; CSV bleibt als eigenstaendige technische Projektion verfuegbar und traegt dieselbe kanonische Run-ID wie JSON. `sync-dist` (`scripts/sync-dist.mjs`) baut `dist/` ausschliesslich aus einem Git-Commit; ohne `--rev` verlangt es einen sauberen Stand der versionierten Quellen, blockiert unversionierte Runtime-Quelldateien und ignoriert sonstige unversionierte Scratchdateien sowohl fuer die Clean-Pruefung als auch fuer `dist/`. Ein plattformunabhaengiger Test fuehrt das Skript in einem echten Git-Fixture aus und pinnt Pflichtdateien, Scratch-Ausschluss, Provenienz und Rejectpfade. Der Result-Fingerprint umfasst Schema, Request, kanonisches Ergebnis und Semantikvertraege. `exportedAt`, generierte IDs, Exportmetadaten und interne Diagnostik sind ausgeschlossen. Beide Downloadnamen enthalten Zeitraum, denselben 12-stelligen Run-Hashkern und den Exportzeitpunkt; JSON traegt zusaetzlich den Result-Fingerprint, CSV ihren getrennten Byte-Fingerprint.

### `historical-backtest-ui.js`

DOM-naher, aber rechensemantikfreier UI-/Accessibility-Vertrag fuer historische Backtests.

**Hauptfunktionen / Exporte:**
- `configureHistoricalBacktestControls()` / `validateHistoricalBacktestPeriod()` – projizieren Provider-Bounds in die Felder und validieren leere, nicht-finite, nicht-ganzzahlige, rueckwaertige und ausserhalb liegende Perioden sowie den optionalen Cohort-Horizont.
- `describeHistoricalBacktestResult()` / `renderHistoricalBacktestStatus()` – unterscheiden fachliche Outcomes und sanitizieren Nutzertexte auf stabilen Code, Ursache und Handlungsoption ohne Stack-/Pfaddetails.
- `summarizeHistoricalBacktestDataQuality()` / `renderHistoricalBacktestNotices()` – zaehlen kanonische Observation-Qualitaetsmarker und zeigen die In-sample-Aussagegrenze.
- `createImmutableCohortInventory()` / `renderHistoricalBacktestCohorts()` – teilen denselben tief eingefrorenen Inventarsnapshot mit UI und JSON-Export; Null-Eligible-Raten bleiben `null`/`—` statt `NaN`.
- `buildAccessibleBacktestTableHtml()` – Kompatibilitätsadapter zum gemeinsamen `renderProtocolTable()` mit Caption, Gruppenkopf, stabilen Spaltenankern und escaped Zellwerten.

### `simulator-backtest.js`

UI-Adapter, Rendering und expliziter Download fuer historische Backtests.

**Hauptfunktionen / Exporte:**
- `initializeBacktestUI()` – verdrahtet Start-, Detail-, Cohort- und Downloadcontrols genau einmal und persistiert nur die bestehende Detailstufe.
- `runBacktest()` – liest und validiert DOM-Inputs, delegiert an `runHistoricalBacktest()` und optional `runHistoricalBacktestCohorts()` und legt das immutable `BacktestRunResultV1` gemeinsam mit derselben Row-Referenz dokumentlokal in `window.globalBacktestData` ab. Injektionsoptionen dienen deterministischen Browser-Gates; der Standardpfad nutzt die produktiven Dependencies.
- `runBacktestWithRuntimeProvenance()` – Singleflightvorbereitung mit abwartbarem `cancelBacktestPreparation()`. Nach Navigationszustimmung wird das Ende des offenen Provenienzloaders abgewartet; weder dessen späte Antwort noch dessen Fehler starten danach den synchronen Runner. Der direkte `runBacktest()`-Pfad bleibt synchron und startet nicht während einer offenen Vorbereitung/Navigation.
- Der Provider `simulator-backtest` meldet Vorbereitung und erfolgreiches vorhandenes Ergebnis. Downloads entfernen keinen Ergebnisgrund; Bleiben erhält Ergebnis und Vorbereitung. Es entstehen keine persistenten Laufzustände und keine neue Ergebnisablage.
- `renderBacktestLog()` / `exportBacktestLogData()` – lokalisierte semantische Tabelle beziehungsweise JSON-/CSV-Download ueber den Raw-Serializer; JSON erhaelt bei aktivierter Diagnose exakt das angezeigte Cohort-Inventar.
- Backtest-Logs zeigen Haushalts-Flex, finale Haushaltskuerzung, Mindest-Flex-Ziel, final wirksamen Betrag, Fehlbetrag und Status; die Raw-CSV trennt Haushalts-, Renten- und Depotbasis. Die Ergebnisuebersicht bezeichnet den Pflegebucket als bereits im Endvermoegen enthalten, damit der separat sichtbare Diagnosewert nicht addiert wird.

**Einbindung:** Wird in `initializeUI()` importiert und bindet den Startbutton ohne Inline-Handler an die Backtest-Controls. Nutzt `historical-backtest-runner.js` fuer die DOM-freie Jahresschleife, `historical-backtest-ui.js` fuer UI/A11y, `historical-backtest-export.js` fuer Raw-Downloads und `simulator-main-helpers.js` als Kompatibilitätsadapter zum Protokollkatalog.

**Dependencies:** `historical-backtest-runner.js`, `historical-backtest-cohorts.js`, `historical-backtest-ui.js`, `historical-backtest-export.js`, `simulator-engine-wrapper.js`, `simulator-portfolio.js`, `simulator-main-helpers.js`, `simulator-utils.js`, `simulator-data.js`.

---

## 9. `simulator-main-helpers.js` (~280 Zeilen)
Formatierungs- und Export-Helfer, damit Tabellen-/KPI-Aufbereitung nicht in `simulator-main.js` landet.

**Hauptfunktionen / Exporte:**
- `computeAdjPctForYear()` / `applyPensionTax()` – Renten-spezifische Hilfen für Berechnungen und Steuerung.
- `formatCellForDisplay()` / `formatColumnValue()` / `prepareRowsForExport()` – Tabellengenerierung und CSV-Helpers.
- `triggerDownload()` – generischer Download-Wrapper.

**Einbindung:** Von `simulator-main.js`, `simulator-backtest.js` und `simulator-results.js` genutzt. Neue UI-nahe Helfer sollten hier statt in `simulator-main.js` landen.

**Dependencies:** `simulator-utils.js`.

---

## 10. `simulator-ui-pflege.js` (~180 Zeilen)
Pflege-spezifische UI-Initialisierung (Presets, Badges, Toggles).

**Hauptfunktionen / Exporte:**
- `initializePflegeUIControls()` – richtet alle Pflege-Listener ein (Preset-Auswahl, Info-Badges, Panels sichtbar/unsichtbar).
- `applyPflegeKostenPreset()` / `updatePflegePresetHint()` / `updatePflegeUIInfo()` – UI-Verhalten bei Presets und Kontext-Hinweisen.

**Einbindung:** Wird in `initializeUI()` aufgerufen, bevor Simulationen gestartet werden. Erwartet vorhandene DOM-IDs aus dem Pflege-Panel. Pflege-spezifische UI-Erweiterungen gehören hierher, nicht in `simulator-main.js`.

**Dependencies:** `simulator-utils.js`, `simulator-data.js`.

---

## 11. `simulator-ui-rente.js` (~240 Zeilen)
Lesende Darstellung zentraler Renten-/Personenparameter; Legacy-Umstellung erfolgt gesichert vor Seitenbereitschaft.

**Hauptfunktionen / Exporte:**
- `initRente2ConfigWithLocalStorage()` – sperrt Personenwertträger und markiert sie als nicht persistent; liest/schreibt keine alten Personenkeys.

**Einbindung:** Direkt aus `initializeUI()` aufgerufen, damit vor Monte-Carlo/Sweep alle Rentenfelder konsistent geladen sind.

**Dependencies:** keine externen Module.

---

## 12. `simulator-engine-direct.js` & `simulator-engine-helpers.js`
Kernlogik für Jahr-für-Jahr-Simulation (Direct Engine).

**Hauptfunktionen:**
- `simulateSingleYear()` (Direct) – simuliert ein Jahr via EngineAPI
- `resolveSimulatorCumulativeInflationFactor()` / `advanceSimulatorCumulativeInflationFactor()` (Helpers) – lesen den App-eigenen Faktor mit Legacy-Fallback und schreiben ihn für das Folgejahr genau einmal fort.
- Der kanonische Faktor liegt auf `simState.cumulativeInflationFactor`; `simulator-engine-direct.js` spiegelt ihn für Realvermögen und Real-Drawdown in den Engine-`lastState`.
- Recompute-Pfad für Notfallverkäufe: kombiniert reguläre + Notfall-Rohaggregate und rechnet Settlement mit `taxStatePrev` neu.
- Pflegebucket-Pfad: nutzt `simulator-health-bucket.js` nach der Engine-Entscheidung und vor `applyForcedSaleLiquidityCoverage()`, damit zweckgebundene Geldmarkt-/Cash-Reserve Pflege-Liquiditätslücken deckt, bevor Risikoanlagen notverkauft werden.
- `sampleNextYearData()` (Helpers) – sampelt das nächste kanonische Jahr (historisch/Regime/Block); fehlende Historie, leere effektive Regimepools und unbrauchbare Transitionen scheitern fail-closed statt Null-/SIDEWAYS-Daten zu erfinden oder auf ungefilterte Jahre zurueckzufallen
- `makeDefaultCareMeta()` / `updateCareMeta()` (Helpers) – Pflegefall-Zustandsmaschine
- `calcCareCost()` (Helpers) – berechnet Pflege-Kosten nach Grad
- `computeCareMortalityMultiplier()` (Helpers) – erhöhte Sterblichkeit bei Pflege
- `computeHouseholdFlexFactor()` (Helpers) – Flex-Reduktion bei Pflege
- `initMcRunState()` (Helpers) – initialisiert Zustand für einen MC-Lauf

**Ausgelagerte Jahreslogik:**
- `simulator-year-portfolio.js` – DOM-freie Markt-/Portfoliofortschreibung, Renditen und Marktfenster.
- `simulator-household-pension.js` – DOM-freie Renten-/Haushaltsberechnung inklusive Witwenrente.
- `simulator-engine-input.js` – DOM-freies Mapping von Simulator-Jahreswerten auf den `EngineAPI.simulateSingleYear()`-Input. Auch ein leeres aktuelles `detailledTranches` ersetzt das ursprüngliche Startinventar.
- `simulator-portfolio-inventory.js` – gemeinsame verfügbare Lotbasis für Aktien-/Goldsummen und detailliertes Quellinventar, ohne Kleinstwertschwelle. Der bestehende Drei-Topf-Bondaggregat-/Refillpfad und seine Bewertung bleiben unverändert.
- `minimumFlexAnnual` wird wie `startFlexBedarf` als nominal fortgeschriebener Jahreswert in den Engine-Input gemappt und im Jahresstate inflationiert. Die Policy laeuft nach Guardrails und vor Flex-Budget und finaler Glaettung; sie rechnet den Rentenueberschuss nach Floor-Deckung auf das Haushaltsziel an. Erst nach der finalen Monatsquantisierung werden `minimumFlexEffectiveFinal` als Rentenueberschuss plus Depotflex, `minimumFlexShortfallAnnual` und `minimumFlexFulfilled` festgeschrieben. Dieselbe final quantisierte Portfolioauszahlung ist die kanonische Basis fuer Liquiditaetsziel und operative Runway-KPIs; die Dynamic-Flex-Safety behaelt bewusst ihren Rohbedarfsnenner.
- `simulator-accumulation-year.js` – DOM-freier frueher Rueckgabepfad fuer Ansparjahre inklusive Sparrate, Cash-Zins, Anspar-Rebalancing, Logdaten und Fortschreibung des kumulierten Inflationsfaktors trotz Entnahme null.
- `simulator-tax-recompute.js` – DOM-freie Normalisierung von Tax-Rohaggregaten und finales Settlement-Recompute nach Simulator-Zusatzverkaeufen oder einer steuerrelevanten 3-Bucket-Ersetzung. Skaliert die regulaere Cash-Reserve konsistent, kumuliert Forced-Sale-Reserven und liefert die genau einmal cashwirksame Differenz zur finalen Jahressteuer; Reserveunterdeckungen unter -0,01 EUR sind Contract-Fehler. Der vor Ausfuehrung gepruefte Plan bleibt als `plannedActionFlow` erhalten. `SimulatorExecutedTaxContractV1` prueft und dokumentiert die Abweichung zwischen Quellen-Planreserve und dem kompatiblen Top-Level-Feld `action.steuer`, das nach Simulator-Zusatzeffekten die finale Jahressteuer traegt.
- `simulator-forced-sale.js` – DOM-freie Forced-Sale-Liquiditaetsdeckung vor/nach Auszahlung inklusive Forced-Sale-Scale, skalierter Plansteuerreserve ohne erneuten SPB, Bond-Verkaufsdelta, Payout-Fallback und FIFO-Fallback.
- `types/planned-action-contract.js` – gemeinsamer Action-Vertrag fuer Core und Direct: kanonische Typen/Keys, ausgeglichene Quellen und Verwendungen, Brutto-Steuer-Netto, Cash-Kapazitaet, eindeutige Lotzuordnung sowie aus Cost Basis/TQF/Steuerfreiheit abgeleitete signierte Rohsteuerwerte. Das V1-Modell `proportional_market_value_v1` setzt die bestehende proportionale Reduktion von Marktwert und Cost Basis innerhalb jedes Lots voraus und reconciliert die internen Rohwerte mit absolut `1e-7`; centgerundete Fremdadapter oder eine nichtproportionale kuenftige Lotauswahl gehoeren nicht zu diesem V1-Vertrag. `simulator-engine-direct.js` wendet ihn auf den rohen Engine-Plan und erneut auf die 3-Bucket-finalisierte Action an; der rohe Jahressteuerabschluss muss zusaetzlich exakt zu `settleTaxYear()` und `newState.taxState` passen.
- `simulator-health-bucket.js` – DOM-freier Pflegebucket-Trigger, Deckungsbedarf, Verbrauch, Verzinsung, Zieldeckungsdiagnose und Warnungsweitergabe.
- `simulator-bond-refill.js` – DOM-freie Bond-Refill-/3-Bucket-Nachsteuerung fuer gute Jahre inklusive Auto-Bond-Tranche, Equity-Verkauf und Refill-Deltas.
- `simulator-year-result.js` – DOM-freier Builder fuer finalen Rueckgabewert, naechsten State, UI-Payload, Jahreslog, 3-Bucket-Logshape sowie flache Entnahme-/Payout-/VPW-Erklaerfelder. `jahresentnahme_real` ist die effektive Auszahlung geteilt durch den aktuellen Faktor; erst der Folgejahresstate erhält den einmal mit der Jahresinflation fortgeschriebenen Faktor. Die FlowDelta-Bilanz umfasst die nach Auszahlung gebuchte Steuer-Reconciliation.

**Dependencies:** `simulator-utils.js`, `simulator-data.js`, `EngineAPI` (engine.js)

---

## 13. `simulator-results.js` (~320 Zeilen)
Aggregation der Monte-Carlo-Ausgabe, Orchestrierung von KPI-Berechnung und Rendering.

**Hauptfunktionen:**
- `displayMonteCarloResults()` – zeigt MC-Ergebnisse mit Szenario-Log-Auswahl
- `renderWorstRunLog()` – rendert Jahresprotokoll als HTML-Tabelle
- `getWorstRunColumnDefinitions()` – Spaltenkonfiguration für Log-Tabellen
- `loadDetailLevel()` / `persistDetailLevel()` – Detail-Einstellungen speichern
- leitet an `results-metrics.js` (Berechnungen) und `results-renderers.js` (DOM)

**Features:**
- Vier Gruppen und eine Listbox für bis zu 31 Szenario-Logs (bis zu 16 charakteristische + 15 zufällige)
- Checkboxen für Pflege-Details und detailliertes Log
- Detailspalten fuer Entnahme-/Payout-/VPW-Transparenz (`EntPlan`, `EntEff`, `VPW€`, `VPWFlex`, `StatFlex`, `Liq>P`, `Liq<P`, `Liq>Z`, `Port>P`, `PortEnd`)
- Mindest-Flex-Spalten: `MinFlex€`, `MinFIst€`, `MinFGap€`, `MinFSt` sowie im Detailmodus `MinFBlock` und der Policy-Zwischenwert `MinFEff`
- JSON/CSV-Export fuer ausgewaehlte Szenarien als `ScenarioLogExportV2`; beide Formate verwenden dieselbe lazy beim Klick erzeugte validierte Projektion und tragen Contractversionen je Export beziehungsweise CSV-Zeile. Ein Szenariowechsel verwirft den alten Exportzustand vor dem Rendern; Projektionsfehler erzeugen einen sichtbaren Hinweis statt eines alten oder partiellen Downloads.
- Pflege-KPI-Dashboard mit getrennten P1-/P2-Verteilungen, Stichprobengroessen, nullable bedingten Kennzahlen und realen Haushalts-Mehrbedarfen
- enthält zusätzlich Metriken für `taxSavedByLossCarry` aus Sweep/MC-Ergebnissen
- enthält zusätzlich Pflegebucket-KPIs aus MC-Ergebnissen: Nutzungsquote, Erschoepfungsquote, Median-/P90-Nutzung, Median-Restbucket, Zieldeckung und Zielluecke
- enthält bei aktivem Tail-Risk-Overlay zusaetzliche KPI-Karten fuer aktive/applizierte Runs, aktive/applizierte Jahresanteile und historische Krisen-Skips; Scenario-Log-JSON/CSV exportiert die Tail-Event-Felder unverkuerzt aus den Row-Daten.

**Dependencies:** `simulator-utils.js`, `simulator-heatmap.js`, `simulator-data.js`, `results-metrics.js`, `results-renderers.js`, `results-formatting.js`.

---

## 14. `results-metrics.js` (~200 Zeilen)
Berechnet alle KPIs (Perzentile, Quoten, Pflege-Kosten/Overlap, Shortfall-Deltas) ohne DOM-Zugriffe.

**Hauptfunktionen:**
- `computeKpiCards()` / `computeScenarioSummary()` – strukturierte KPI-Objekte für Renderer.
- Rendert u. a. die KPI `Ø Steuerersparnis Verlusttopf` auf Basis von `extraKPI.lossCarryTaxSavings.perRunMean`.
- Rendert Pflegebucket-Kennzahlen, wenn `extraKPI.healthBucket` vorhanden ist.
- `buildKpiDashboard()` bezeichnet `depotErschoepfungsQuote` sichtbar als
  „Ruin oder Aktien/Gold ≤ 100 €“ und stellt klar, dass freie Liquidität und
  Pflegebucket nicht zur 100-Euro-Schwelle gehören; technischer Key und
  Aggregation bleiben unverändert.
- Entscheidungskritische EUR-Werte einschliesslich der P10/P50/P90-
  Endvermoegens-Summary werden ohne Grobstufenrundung centgenau aus
  `aggregatedResults` projiziert. Zusaetzliche Dezimalstellen werden fuer
  Nutzen abwaerts und fuer Kosten aufwaerts quantisiert. Nominaler und realer
  Maximum-Drawdown werden ohne UI-Neuberechnung als positive Verlustbetraege
  in der Domaene 0 bis 100 Prozent validiert und zur sichtbaren
  Hundertstel-Prozentpunktgrenze aufwaerts quantisiert. Ungueltige, fehlende
  oder nicht anwendbare Werte liefern Gedankenstrich, stabilen Grund und eine
  tatsaechlich vorhandene Beobachtungszahl; andernfalls steht `unbekannt`.
  Bei mehreren Missingness-Ursachen wird der Grund mit dem groessten
  aggregierten Zaehler deterministisch ausgewaehlt.
- Die sichtbare 4,5-Prozent-KPI benennt die realisierte Entnahmequote mit dem
  strikten `>`-Operator und ordnet sie als Berichtsreferenz statt als Alarm-
  oder Guardrail-Schwelle ein. Pflege-Gruppenmediane bleiben sichtbar als
  ungepaarter, nicht kausaler Vergleich gekennzeichnet.

**Dependencies:** `results-formatting.js`, `simulator-utils.js`.

---

## 15. `results-renderers.js` (~240 Zeilen)
Rendering-Layer für KPI-Karten, Tabellen und Badges.

**Hauptfunktionen:**
- `renderKpiCards()` – erzeugt HTML für KPI-Dashboard.
- Die Szenarioauswahl wird von `scenario-log-view.js` über Gruppen und Listbox gebunden.
- Exaktwertkarten unterstuetzen sichtbare Zweitwerte und Statuszeilen. Alle
  KPI-/Summary-Titel und Werte duerfen umbrechen, sodass auch Pflege-
  Nichtkausalitaet und lange 4,5-Prozent-Titel sichtbar bleiben. Nominale und
  reale Drawdowns erscheinen in einer eigenen Paarmatrix; der
  Berichtsrollenhinweis bleibt auch ausserhalb eingeklappter Detailbereiche
  sichtbar. Bei 320 Pixel bleibt die vollstaendige Simulatorseite ohne
  horizontalen Seitenoverflow; breite Logtabellen scrollen lokal.

**Dependencies:** `results-formatting.js`, `simulator-utils.js`.

---

## 16. `auto_optimize.js` & `auto_optimize_ui.js`
Auto-Optimierung für Parameter (LHS + Verfeinerung) und UI-Bedienung. Details siehe: `docs/reference/AUTO_OPTIMIZE_DETAILS.md`.

**Hauptfunktionen / Exporte:**
- `runAutoOptimize()` – Orchestriert den mehrphasigen Prozess (LHS-Kandidaten -> Quick-Filter -> volle Evaluation -> Refinement -> Validierung).
- UI-Integration in `auto_optimize_ui.js` als Fassade fuer Initialisierung, Event-Wiring, Run-Flow und Parameter-Management.

**Modul-Split:**
Die Logik wurde in spezialisierte Module zerlegt, um Wartbarkeit und Testbarkeit zu erhöhen:

- `#ao_cancel_btn` – sichtbarer Abbruchknopf, während des Laufes freigegeben und nach Handlercleanup gesperrt; verwendet denselben Abbruchpfad wie Navigation.
- `cancelAutoOptimize()` – kündigt den Singleflightlauf des UI-Handlers und wartet alle Kandidaten, Seeds sowie Handlercleanup ab. Signal- und Generationsprüfungen verhindern Folgejobs, Fortschritt und Championpublikation nach Kündigung; Workerinit und Jobs sind generationengebunden, der serielle Ersatzrunner erhält dasselbe Signal. Gewöhnliche Workerfehler behalten den Fallback.
- `simulator-auto-optimize` meldet Rechnung und vorhandenen Champion gemeinsam an den Navigationsschutz. Erfolgreiche Altresultate bleiben bei Fehler/Abbruch eines Folgelaufs verfügbar. Übernahme oder Download quittieren sie nicht. Die gemeinsame Nachfrage kann gleichzeitig MC-, Sweep-, Backtest- und AO-Gründe enthalten; Ergebnisablage folgt erst mit Paket 4.2.
- `auto-optimize-worker.js` – Der Worker-To-Main-Adapter. Nutzt den gemeinsamen `workers/mc-worker.js`-Jobtyp `job`, merged MC-Buffers/Heatmap/Totals/Listen fuer Kandidaten-Evaluationen und faellt bei Worker-Fehlern auf seriell zurueck.
- `auto-optimize-evaluate.js` – Bewertet Kandidaten anhand gepoolter kanonischer MC-Rohverteilungen. `AutoOptimizeMetricResultV1` weist Endvermoegensquantile, P90-Drawdown, D-14-Entnahmequote, Stichprobengroessen und Missingness aus. `MonteCarloFinancialRunDistributionV1` entfernt technische Pfade aus Endvermoegen und Drawdown, inventarisiert die Ausschluesse und laesst den Optimizer bei technischer Missingness fail-closed abbrechen. D-14 nimmt das tatsaechlich berechnete finale Ruinjahr auf; dessen Quote verwendet nur die tatsaechlich ausgezahlte `jahresEntnahmeEffektiv` und den Depotwert vor Auszahlung. Ein Ruin vor der Auszahlung bleibt als beobachtete Nullauszahlung enthalten. Safety-Penalty und Tiebreaker akzeptieren nur endliche primitive Zahlen aus beidseitig versionierten Resultaten.
- `auto-optimize-metrics.js` – Definiert Objective- und Constraint-Reader fuer den flachen versionierten Metrikshape. Endvermoegensquantile verwenden lineare Interpolation bei `(n-1)q`; fehlende Werte werden niemals als guenstige 0 eingesetzt.
- `auto-optimize-sampling.js` – Algorithmen für die Kandidatengenerierung (Latin Hypercube, Nachbarschaft).
- `auto-optimize-utils.js` – Hilfsfunktionen (Caching, Logging, ID-Generierung) sowie der versionierte Tiebreaker auf Success Rate, realem `worst5Drawdown` und Zeitanteil oberhalb 4,5 Prozent.
- `auto-optimize-params.js` – Definition der Parameter-Räume und Mapping (UI <-> Intern).
- `auto-optimize-presets.js` – DOM-freie Preset-Definitionen fuer die UI.
- `auto-optimize-param-meta.js` – Parameter-Optionen, Labels, Units, Dynamic-Flex-Keys und Apply-Mapping.
- `auto-optimize-config-ui.js` – Liest und validiert die UI-Konfiguration fuer `runAutoOptimize()`.
- `auto-optimize-renderer.js` – Rendert Parameterbloecke, Progress-Texte, Ergebnis-HTML und Apply-Erfolgsmeldung.
- Objective-, Constraint- und Ergebnis-Copy bezeichnet die bestehende
  4,5-Prozent-Metrik als Zeitanteil der realisierten Entnahmequote strikt
  groesser 4,5 Prozent und als reine Berichtsreferenz; die stabilen technischen
  Metric-Keys und ihre Berechnung bleiben unveraendert.
- `auto-optimize-apply.js` – Uebernimmt Champion-Parameter in die Simulator-Formularfelder.

**Dependencies:** `simulator-portfolio.js`, `monte-carlo-runner.js`, `simulator-engine-helpers.js`, `workers/worker-pool.js`.

---

## 17. `results-formatting.js` (~160 Zeilen)
Hält Formatierungs-Utilities und kleine Adapter, um Renderer und Metriken von DOM-Details zu entkoppeln.

**Hauptfunktionen / Exporte:**
- `formatCurrencySafe()` – Währungsformat mit Fallback
- `formatNumberWithUnit()` / `formatPercentage()` – Zahlen-/Prozent-Formatter
- `sanitizeDescription()` – Text-Sanitizing für KPI-Labels

**Dependencies:** `app/shared/shared-formatting.js`.

---

## 18. `app/shared/shared-formatting.js` (~140 Zeilen)
Zentrale Formatierer für Währung, Zahlen und Einheiten (Balance + Simulator).

**Hauptfunktionen / Exporte:**
- `formatCurrency()` / `formatCurrencyShortLog()` / `formatCurrencyRounded()` – Währungs-Formatter
- `formatNumber()` – Ganzzahlformatierung
- `formatPercent()` / `formatPercentValue()` / `formatPercentRatio()` – Prozent-Formatter
- `formatMonths()` – Monatswerte
- `formatNumberWithUnit()` / `formatPercentage()` – Zahlen-/Prozent-Formatter

**Dependencies:** keine

---

## 19. `simulator-formatting.js` (~20 Zeilen)
Re-Exports der gemeinsamen Formatter für den Simulator.

**Hauptfunktionen / Exporte:**
- Re-export aller Formatter aus `app/shared/shared-formatting.js`

**Dependencies:** `app/shared/shared-formatting.js`

---

## 20. `simulator-portfolio.js` (Fassade)
Portfolio-Initialisierung, Renten- und Stress-Kontexte.

**Hauptfunktionen:**
- `getCommonInputs()` – liest alle Portfolio-/Strategie-Inputs
- `updateStartPortfolioDisplay()` – UI-Display für Start-Allokation
- `initializePortfolio()` / `initializePortfolioDetailed()` – Tranchen-Setup inklusive optionalem Pflegebucket-Carve-Out nach Profilverbund-Merge
- `computeRentAdjRate()` / `computePensionNext()` – Rentenanpassungslogik
- `resolveStressHistoricalPool()` / `buildStressContext()` / `applyStressOverride()` – gepinnte historische Stresspools mit Kalenderjahresclustern und Mindestdiversitaet sowie Stresstest-Szenarien/Overrides; Kontextaufbau und Laufzeit-Schnittmenge erzwingen die Diversitaet zusaetzlich zum Vertragspreflight

**Helper-Module (ausgelagert):**
- `simulator-portfolio-inputs.js` – DOM-Input-Parsing
- `simulator-portfolio-display.js` – Start-Portfolio-UI
- `simulator-portfolio-init.js` – Portfolio-Tranchen und Pflegebucket-Carve-Out aus Geldmarkt-Tranchen, ungetranchtem Geldmarkt und Tagesgeld
- `simulator-portfolio-historical.js` – Regime-Daten vorbereiten
- `simulator-portfolio-pension.js` – Rentenberechnungen
- `simulator-portfolio-stress.js` – Stress-Presets/Overrides
- `simulator-portfolio-tranches.js` – FIFO/Tax/Portfolio-Updates
- `simulator-portfolio-format.js` – Zahlformatierung

**Pflegebucket-Contract in `simulator-portfolio-init.js`:**
- Der Carve-Out läuft erst auf dem aggregierten Haushaltsportfolio, nicht pro Einzelprofil.
- Quellenreihenfolge: `depotTranchesGeldmarkt` per FIFO, danach ungetranchter `geldmarktEtf`, danach `tagesgeld`.
- Fehlende Kaufdaten unterstuetzter Legacy-Lots verwenden einen stabilen FIFO-Fallback. Syntaktisch oder fachlich korrupte Profilpayloads erreichen die Portfolioinitialisierung nicht.
- `geldmarktEtf`, `tagesgeld` und `liquiditaet` werden konsistent reduziert.
- `healthBucketGeldmarkt`, `healthBucketTranches`, `healthBucketCashAmount` und `healthBucketMeta.warnings` dokumentieren die Ausgliederung und eventuelle Kappung.

**Dependencies:** `simulator-data.js`

---

## 21. `simulator-heatmap.js` (~480 Zeilen)
SVG-Rendering für Parameter-Sweeps und Heatmaps.

**Hauptfunktionen:**
- `renderHeatmapSVG()` – erzeugt SVG-Heatmap mit Farbskala
- `getColorForValue()` – Farbzuordnung nach Metrik
- `renderParameterSweepResults()` – vollständige Sweep-Ergebnisdarstellung
- Die 4,5-Prozent-Ueberlagerung benennt ihre klassenbedingte `>=`-Semantik
  ausdruecklich und bleibt damit vom strikt-`>`-Gesamt-KPI unterscheidbar.

**Dependencies:** `simulator-utils.js`

---

## 22. `simulator-utils.js` (~320 Zeilen)
Zufallszahlen und Statistik (Formatierung wird aus `app/shared/shared-formatting.js` re-exportiert).

**Hauptfunktionen:**
- `rng(seed)` – Seeded PRNG mit `.fork()` für unabhängige Streams
- `quantile()` / `mean()` / `sum()` – Statistikfunktionen
- `shortenText()` – Text auf Maximallänge kürzen

**Dependencies:** keine

---

## 23. `simulator-data.js`
Historische Datenprojektion 1925-2025, Re-Exports des
Demografie-/Pflegevertrags und Stress-Presets.
Die Aktienlevels werden nicht mehr als zweite Zahlenreihe gepflegt, sondern
aus `global-equity-research-chain.js` importiert. Die deutschen
Inflationswerte werden ebenso ausschliesslich aus
`german-cpi-chain.js` projiziert. `zinssatz_de` stammt ausschliesslich aus
`german-cash-money-market-chain.js`; `gold_eur_perf` ausschliesslich aus
`gold-german-investor-chain.js`.

**Exporte:**
- `HISTORICAL_DATA` – historische Marktdaten mit dem neutralen Feld
  `global_equity_research_index` sowie Gold, Inflation, Zins, Lohn und CAPE
- `MORTALITY_TABLE` – generierte Periodensterbetafel nach Geschlecht und Alter
- `PFLEGE_GRADE_PROBABILITIES` – explizite Modellannahmen fuer initialen
  Pflegeeintritt in Grad 1 oder 2; keine amtliche Praevalenz
- `STRESS_PRESETS` – Stresstest-Szenarien (GFC, Stagflation, Lost Decade, System-Krise etc.)

**Dependencies:** `global-equity-research-chain.js`, `german-cpi-chain.js`,
`german-cash-money-market-chain.js`, `gold-german-investor-chain.js`,
`german-demography-care-survivor-contract.js`

---

## 23a. `german-demography-care-survivor-contract.js`

Generiertes, tief eingefrorenes Datenartefakt fuer Sterblichkeit,
Pflegebeobachtungen/-modellannahmen und Hinterbliebenengrenzen.

- Destatis `Statistischer Bericht Sterbetafeln 2023/2025` (EVAS 12621),
  Tabellen `12613-b01` und `12613-b02`: amtliche `qx` fuer Mann/Frau und Alter
  18-100; Alter 101-110 ist ein separater Modellrand, `divers` der
  ungewichtete Mittelwert und keine amtliche dritte Tabelle.
- Destatis-Pflegestatistik 2023: Bestandszahlen, Pflegegradanteile und
  alters-/geschlechtsspezifische Pflegequoten nur als
  `context_only_not_runtime_validation_or_transition_probability`; es findet
  keine Laufzeitvalidierung gegen diese Praevalenzen statt.
- Pflegeeintritt Grad 1/2, Progression und Dauer sind getrennte
  Modellannahmen. Die fruehere unbelegte Praevalenz-durch-vier-Herleitung ist
  entfernt.
- Der Hinterbliebenenvertrag beschreibt `percent`/55 als UI-Default und
  grenzt die vereinfachte Cashflow-Logik von einer gesetzlichen
  Anspruchsberechnung ab.
- `monte-carlo-runner.js` exportiert Revision, Hashes und Semantikgrenzen als
  `DemographyCareSurvivorDiagnosticsV1`.
- `post-backtest-data-07-v1` misst mit festem Seed 2.048 Runs ueber 40 Jahre
  und zwei Sweep-Kombinationen. Pflege, Partner und Hinterbliebenen-Cashflow
  sind aktiv; 40 numerische Slice-06-zu-Slice-07-Deltas bleiben bis zum
  externen Review `pending`.

**Build:** `npm run build:german-demography-data`
**Verify:** `npm run verify:german-demography-data`

---

## 23b. `global-equity-research-chain.js`

Generiertes, tief eingefrorenes Datenartefakt fuer die offene
16-Laender-Aktien-Forschungsproxykette. Das Buildskript prueft die Original-
und gefilterten JST-/OECD-/EZB-Eingabehashes, rekonstruiert die Filterung
bytegenau, berechnet Vorjahres-Wirtschaftsgewichte, Waehrungsumrechnungen,
Jahresreturns und die stetige Levelkette. Der USD-Proxy reicht einschliesslich
1950; die deutsche Anlegerwaehrung beginnt erst mit dem Return 1951.

**Exporte:**

- `GLOBAL_EQUITY_RESEARCH_CHAIN` – Version, Quellenhashes,
  Numeraireuebergang, Qualitaetssegmente, Gewichte, Country-Counts, Returns
  und Levels;
- `GLOBAL_EQUITY_RESEARCH_ANNUAL_RETURNS` – 1925-2025-Returnprojektion;
- `GLOBAL_EQUITY_RESEARCH_INDEX_LEVELS` – kanonische Laufzeitlevels.

**Erzeugung:** `npm run build:global-equity-data`. Die JST-abgeleiteten
Datenwerte stehen separat unter `CC BY-NC-SA 4.0`; Details liegen in
`data/historical/global-equity-research-chain/`.

---

## 23c. `german-cpi-chain.js`

Generiertes, tief eingefrorenes Datenartefakt fuer die deutsche
Jahresdurchschnitts-Verbraucherpreisinflation 1925-2025. Das Buildskript
prueft die Hashes des wiederverwendeten JST-R6-Originals, der gepinnten
Destatis-Langreihen-XLSX und des aktuellen Destatis-HTML-Snapshots. Es
berechnet die JST-Levelaenderungen bis 1949, liest die veroeffentlichten
Destatis-Jahresraten ab 1950 und prueft diese gegen aufeinanderfolgende
Jahresdurchschnittslevel mit hoechstens 0,05 Prozentpunkten Abweichung; damit
wird jede Abweichung um einen publizierten Tick von 0,1 Prozentpunkten
abgewiesen. Ein
getrennter Testreader rekonstruiert alle 101 Raten direkt aus den gepinnten
Originalen. Die Integer-Quantisierung 1925-1948, Preisstopp-/Kriegsphase
1936-1948 und der 1949er Waehrungsreform-Splice (`+7,0352` % statt
`-1,0526` % amtlicher Levelalternative) sind maschinenlesbar qualifiziert.
Die separate 100:6,5-Umstellung grosser Reichsmark-Bar- und
Bank-/Sparguthaben (93,5 % nominaler Verlust) wird dem CPI-basierten
Kaufkraftverlust von rund 36,9 % gegenuebergestellt; die Kette ist kein
durchgehender Geldvermoegensdeflator ueber die Reform.
Die Naehte 1950, 1963, 1992 und 2025 bleiben
explizit; HICP/HVPI ist ausgeschlossen.

**Exporte:**

- `GERMAN_CPI_RESEARCH_CHAIN` – Version, Quellenhashes, Auswahl- und
  Nahtregeln, Qualitaetssegmente, Jahresraten und synthetische Indexlevels;
- `GERMAN_CPI_INFLATION_RATES` – kanonische 1925-2025-Laufzeitprojektion;
- `GERMAN_CPI_SYNTHETIC_INDEX_LEVELS` – stetige Diagnoselevel ab Basis 1924.

**Erzeugung:** `npm run build:german-cpi-data`; read-only Gate:
`npm run verify:german-cpi-data`. Die JST-Anteile stehen unter
`CC BY-NC-SA 4.0`, die Destatis-Anteile unter der Datenlizenz Deutschland –
Namensnennung – 2.0. Details liegen in
`data/historical/german-cpi-chain/`.

---

## 23d. `german-cash-money-market-chain.js`

Generiertes, tief eingefrorenes Datenartefakt fuer den deutschen
Cash-/Overnight-Geldmarkt-Bruttoertragsproxy 1925-2025. Das Buildskript
prueft das wiederverwendete JST-R6-Original, die gepinnte
Bundesbank-Langreihen-PDF und den mechanischen Layout-Extrakt. Zusaetzlich
liest es die Primaer-PDF mit Poppler `pdftohtml` ab der kompatiblen
Mindestversion 25.07.0, aufgeloest ueber explizite Umgebungsvariable oder
`PATH`,
rekonstruiert die 77 Bundesbankwerte koordinatenbasiert und verlangt exakte
Uebereinstimmung mit dem Layoutpfad. Ein unabhaengiger Testreader
rekonstruiert alle 101 Werte ohne den Generator direkt aus JST-XLSX und PDF.

Die Segmente bleiben maschinenlesbar getrennt: JST `DEU.stir` 1925-1944 als
Proxy, der offen ausgewiesene 1944-Carry-forward fuer 1945-1948 als
Schaetzung, der Bundesbank-publizierte Frankfurt-Banken-Proxy 1949-1996,
FIBOR 1997-1998, EONIA
1999-2018, der EONIA-/EURSTR-Uebergang 2019 und EURSTR 2020-2025. Der
publizierte Jahresdurchschnitt wird genau einmal als einfacher
Brutto-Jahresertragsproxy verwendet; Produktkosten, Bankmarge und Steuer sind
nicht Bestandteil der Reihe. Negative Raten bleiben signiert. Die
Methodenbrueche 1970 und 1990, der 1948-Waehrungsreformbruch und der
EZB-EURSTR-Disclaimer sind maschinenlesbar.

Der bestehende Laufzeitvertrag heisst `cashBondReturn`: dieselbe Reihe wirkt
auf operative Liquiditaet, Geldmarktpositionen, den cash-nahen Pflegebucket
und Anleihetranchen. Fuer Anleihen ist sie ausdruecklich nur ein
fristigkeitsinkongruenter Modellproxy; Duration, Laufzeitpraemie, Kreditrisiko
und Marktwertbewegungen sind nicht abgebildet. Der 1948-Zinswert bildet die
separate 100:6,5-Abschreibung wesentlicher RM-Geldvermoegen nicht ab.

**Exporte:**

- `GERMAN_CASH_MONEY_MARKET_CHAIN` – Version, Quellenhashes,
  Waehrungsregime, Returnkonvention, Anwendungsbereich, Methoden-/
  Waehrungsbrueche, Disclaimer, Primaer-PDF-Oracle, Qualitaetssegmente,
  Lueckenregel und Jahreswerte;
- `GERMAN_CASH_MONEY_MARKET_ANNUAL_RETURNS` – kanonische
  1925-2025-Laufzeitprojektion.

**Erzeugung:** `npm run build:german-cash-money-market-data`; read-only Gate:
`npm run verify:german-cash-money-market-data`. Details und Quellenbedingungen
liegen in `data/historical/german-cash-money-market-chain/`.

---

## 23e. `gold-german-investor-chain.js`

Generiertes, tief eingefrorenes Datenartefakt fuer die nominale
Gold-Bruttorendite in deutscher Anlegerwaehrung 1925-2025. Das Buildskript
prueft die gepinnten JST-, Bundesbank- und World-Bank-Quelldateien und
  rekonstruiert die segmentierte Jahresend-/Jahresdurchschnittskette
  fail-closed.

Die Segmente bleiben getrennt: US-Jahresend-Policypreis mal JST-Jahresend-
`DEU.xrusd` 1925-1932 und 1934-1944, offizieller RFC-Jahresendpreis 1933,
eine explizite Nullreturn-Schaetzbruecke 1945-1950, Policypreis mal
JST-Jahresend-FX 1951-1967, Bundesbank-Frankfurt-Fixing in DEM/kg 1968-1998 und
World-Bank-Gold in USD/Feinunze geteilt durch Bundesbank USD/EUR 1999-2025.
1968 ist eine Teiljahresnaht ab 18. Juni; 1999 konvertiert 1998 mit
1,95583 DEM/EUR und 32,15074656862798 Feinunzen/kg. Alle zwoelf literal
verbleibenden Nullreturns sind durch Brueckenklassifikation oder unveraenderte
Quellkomponenten belegt; unklassifizierte Nullen schlagen fail-closed fehl.
Die nominale Bruecke ist real gerichtet, und Proxy-/Brueckenjahre bleiben als
sichtbare Modellgrenze im Legacy-Monte-Carlo-Pool.

**Exporte:**

- `GOLD_GERMAN_INVESTOR_CHAIN` – Version, Quellen- und Wertehashes,
  Waehrungsregime, Returnkonvention, Naehte, Qualitaetssegmente,
  Nullwerterklaerungen und Jahreswerte;
- `GOLD_GERMAN_INVESTOR_ANNUAL_RETURNS` – kanonische
  1925-2025-Laufzeitprojektion.

**Erzeugung:** `npm run build:gold-german-investor-data`; read-only Gate:
`npm run verify:gold-german-investor-data`. Details und Quellenbedingungen
liegen in `data/historical/gold-german-investor-chain/`.

---

## 23f. `german-gross-wage-growth-chain.js`

Generiertes, tief eingefrorenes Datenartefakt fuer den Destatis-Index der
durchschnittlichen Bruttomonatsverdienste ohne Sonderzahlungen. Die
publizierte Veraenderung des Berichtsjahres `t` wird bei
`rentAdjMode=wage` genau einmal im Simulationsjahr `t` angewendet. Der
offizielle Abschnitt umfasst 1947-2025; 1925-1946 wird aus aufeinanderfolgenden
JST-R6-`DEU.wage`-Nominallohnstaenden als Forschungsproxy abgeleitet. Gebiet,
fruehe Quellenpraezision und die amtlichen Methodenbrueche 1991, 2007 und 2022
sind explizite Segmente. Die Reihe ist ein funktionaler Rentenfortschreibungs-
proxy und keine gesetzliche Rentenanpassungsreihe.

**Exporte:** `GERMAN_GROSS_WAGE_GROWTH_CHAIN` und
`GERMAN_GROSS_WAGE_GROWTH_PCT`.

**Erzeugung:** `npm run build:german-gross-wage-data`; read-only Gate:
`npm run verify:german-gross-wage-data`. Quelle, Hash und Lizenz stehen unter
`data/historical/german-gross-wage-growth-chain/`.

---

## 23g. `us-shiller-cape-chain.js`

Generiertes, tief eingefrorenes Datenartefakt fuer Robert J. Shillers
konventionelles Price-CAPE des US-Aktienmarkts. Fuer Returnjahr `t` wird die
Dezemberbeobachtung `t-1` ausgewaehlt und mit Beobachtungs-, As-of- und
Entscheidungsjahr exportiert. Der Runtime-Contract liest den unter `t`
gespeicherten Wert einmal. Total-Return-CAPE sowie globale oder deutsche
Marktinterpretationen sind ausgeschlossen. Fuer den oeffentlichen
Publisherdownload wurde keine ausdrueckliche offene Redistributionserlaubnis
gefunden; diese Nutzungsgrenze bleibt dokumentiert. Die durch interpolierte
Vorkriegsinputs betroffenen Entscheidungsjahre 1925-1935 sind `estimated`,
1936-2025 ist `backtested`.

**Exporte:** `US_SHILLER_CAPE_CHAIN` und
`US_SHILLER_CAPE_BY_RETURN_YEAR`.

**Erzeugung:** `npm run build:us-shiller-cape-data`; read-only Gate:
`npm run verify:us-shiller-cape-data`. Quelle und Nutzungsgrenze stehen unter
`data/historical/us-shiller-cape-chain/`.

---

## 23h. `simulation-data-inventory.js`

DOM-freier, unveraenderlicher Evidenz- und Quell-Gate-Contract fuer
historische Reihen und statische Simulationsdaten. Das Modul ersetzt weder
`simulator-data.js` noch den produktiven `HistoricalDataManifestV1`-
Backtestcontract.

**Exporte:**

- `SIMULATION_DATA_INVENTORY` – `SimulationDataInventoryV1`, Revision
  `2026-08-01.4`, mit sechs reihenspezifischen Historieneintraegen und sieben
  statischen Kategorien;
- `validateSimulationDataInventory()` – prueft Pflichtfelder,
  Evidenzvokabular, lueckenlose 1925-2025-Qualitaetssegmente,
  geordnete und eindeutige Reihendiskontinuitaeten,
  Implementierungsabdeckung sowie fail-closed External-Validation-Gates;
- `computeSimulationDataValueHash()` /
  `assertSimulationDataValueHash()` – kanonischer SHA-256-Abgleich gegen
  `embeddedValueHash`; ein nicht vorhandener externer `rawDataHash` bleibt
  davon getrennt `unresolved`;
- `evaluateSimulationDataSourceGate()` – trennt technische
  Reproduzierbarkeit, externe Validierung und Erlaubnis zum Datenersatz.

`unresolved` bleibt technisch reproduzierbar, darf aber weder eine externe
Validierung noch einen lizenzierten Datenersatz behaupten. Alle sechs
Historienketten besitzen bekannte Quellen- und Lizenz- oder Nutzungsfelder,
bleiben wegen Proxy-/Schaetzsegmenten, CAPE-Nutzungsgrenze und ausstehender
externer Validierung jedoch `not_validated`. Modellannahmen,
Nutzereingaben, Stressparameter, abgeleitete Werte und fehlende Modelle tragen
getrennte Evidenzklassen.

Der Lohnpfad trennt 1945 als `estimated` von den umgebenden JST-Proxydaten
und fuehrt die Jahre 1925 (Startnormalisierung), 1945 (keine
Marktlohnbeobachtung), 1947 (JST-/Destatis-Quellennaht) und 1948
(Waehrungsreformkontext) als maschinenlesbare Diskontinuitaeten.

**Dependencies:** `historical-backtest-contract.js` fuer kanonische
Serialisierung und browserkompatibles SHA-256.

---

## 24. `simulator-profile-inputs.js` (~430 Zeilen)
Aggregiert Profildaten zu Simulator-Inputs für Multi-Profil-Setups.

**Hauptfunktionen:**
- `buildSimulatorInputsFromProfileData()` – liest Profildaten aus der Profilregistry hinter der zentralen Persistenz-Facade und baut vollständige Simulator-Inputs
- `combineSimulatorProfiles()` – aggregiert mehrere Profile zu einem kombinierten Input-Objekt (Bedarf aus einem Plan; Demografie weiterhin auf zwei Personen begrenzt)

**Besonderheiten:**
- Goldstrategie: `calculateProfileGoldStrategy()` berechnet Ziel und Floor zuerst je Profil als Eurobetrag auf der reconciliierten frei investierbaren Basis aus Depot inklusive Gold und operativer Liquiditaet. Der Profil-Pflegebucket wird dabei hoechstens bis zur vorhandenen operativen Liquiditaet abgezogen.
- Goldadapter: Absolute Profilziele werden summiert und erst danach in eine Haushaltsquote umgerechnet. `goldZielBetrag`, `goldFloorBetrag` und `goldStrategyDiagnostics` halten den Vertrag nachvollziehbar; `initializePortfolio()` priorisiert das absolute Ziel.
- Tranchen-Aggregation: Fügt detaillierte Tranchen aller Profile zusammen, versieht IDs mit Profilpräfix und setzt `sourceProfileId`
- Verkaufs-Herkunft: Engine-`breakdown[]` bewahrt `sourceProfileId`; Portfolio-Reduktionen laufen ueber die profilbezogene `trancheId`, damit identische Positionen aus verschiedenen Profilen nicht vermischt werden
- Referenzisolation: Profilinputs werden vor Haushaltsmerge und Portfolioinitialisierung tiefenkopiert. Teilverkaeufe reduzieren Stueckzahl, Marktwert und Cost Basis proportional; simulierte Kaeufe erzeugen eigene `simlot:`-Lots.
- Tranchensummen: Valide oder explizit leere Detailtranchen bestimmen die jeweilige Profilrepraesentation. Korrupte oder widerspruechliche Payloads blockieren fail-closed.
- Hybridprovenienz: Existiert eine Detailrepraesentation, blockiert ein weiteres Profil mit positiven Depot-/Geldmarkt-Aggregaten ohne Details mit `SIMULATOR_PROFILE_ASSET_PROVENANCE_MISSING`. Reines Tagesgeld bleibt als separat provenienzfaehige Liquiditaet zulaessig; Aggregate-only Haushalte bleiben kompatibel.
- Pflegebucket: liest `profile_health_bucket`, normalisiert die Definition und nutzt bei Multi-Profil-Setups das Primary-Profil als Haushaltsdefinition. Abweichende sekundäre Definitionen werden als Warnung transportiert.
- Fallback-Logik vor Planbestätigung: Nutzt Balance-Werte wenn Simulator-Felder leer sind
- Nach Planbestätigung werden alte Planfelder vor dem Profilreader ausgeklammert. `combineSimulatorProfiles()` projiziert den Plan nach dem Vermögens-/Tranchenschutz genau einmal; Bedarf und Strategie sind weder Summen noch Maxima oder gewichtete Werte. `minimumFlexProfiles` entfällt, weil der gemeinsame Mindest-Flex keine beweisbare Personenverteilung besitzt. Ohne bestätigten Plan bleibt die bisherige profilbezogene Validierung und Addition aktiv. Auch der Personenalternativenreader erhält über die Profiladapter denselben aktuellen Plan; Personen-, Pflege- und Rentenverträge bleiben unverändert.
- Gewichtete Mittelung bleibt fuer Steuersaetze und Aktienquote bestehen; das Gold-Rebalancing-Band wird zielbetragsgewichtet aus den aktiven Goldprofilen abgeleitet.

**Dependencies:** `simulator-data.js`, `balance-config.js`, `app/profile/profile-asset-values.js`

---

## 25. `profile-storage.js` / `profile-key-policy.js` / `profile-registry.js` / `profile-live-storage.js` / `profile-bundle-io.js`
Profil-Registry und Persistenz-Layer für Multi-User-Verwaltung. `profile-storage.js` bleibt die kompatible Fassade; `profile-key-policy.js` kapselt die Erkennung profilbezogener Persistenz-Keys; `profile-registry.js` kapselt Registry-Parsing, Current-Profile-Key, Metadaten, CRUD und Profildaten-Merge; `profile-live-storage.js` kapselt Snapshot, Clear, Load und Live-Data-Erkennung; `profile-bundle-io.js` kapselt zentralen Bundle-Import/-Export und `window.name`-Transfer.

**Hauptfunktionen:**
- `listProfiles()` / `getProfileMeta()` / `getProfileData()` – Profil-Registry-Zugriff
- `createProfile()` / `renameProfile()` / `deleteProfile()` – CRUD-Operationen
- `switchProfile()` – Wechselt aktives Profil (speichert aktuelles, lädt neues)
- `saveCurrentProfileFromLocalStorage()` – Speichert profilspezifische Keys in Registry
- `exportProfilesBundle()` / `importProfilesBundle()` – Backup/Restore aller Profile

**Profilspezifische Keys:**
- `balance_data` (Balance-App Inputs)
- `depot_tranchen` (Depot-Positionen)
- Alle Keys mit Prefix `sim_` (Simulator-Inputs)
- Snapshots mit Prefix `rs_snapshot_`

**Dependencies:** `profile-state.js`, `profile-key-policy.js`, `profile-registry.js`, `profile-live-storage.js`, `profile-bundle-io.js`

---

## 26. `profile-manager.js` (~190 Zeilen)
UI-Steuerung für Profilverwaltung (index.html).

**Hauptfunktionen:**
- `renderProfiles()` – Zeigt Profilliste mit Checkboxen
- `refreshPrimaryOptions()` – Aktualisiert Primary-Profil Dropdown
- Event-Handler für Erstellen, Umbenennen, Löschen, Aktivieren, Export, Import

**Dependencies:** `profile-storage.js`

---

## 27. `profile-bridge.js` (~40 Zeilen)
Synchronisiert Profildaten zwischen Balance und Simulator beim Seitenwechsel.

**Hauptfunktionen:**
- `initProfileBridge()` – Initialisiert Profile beim Laden; der gemeinsame Unterseiten-Lifecycle sichert bei `beforeunload`, `pagehide` und `visibilitychange=hidden` unter Commit-/Schreibschutz

**Verhalten:**
- Lädt das aktuelle Profil aus der Registry, wenn die Seite geladen wird
- Speichert automatisch bei Navigation (Tab-Wechsel, Schließen)
- Stellt Konsistenz zwischen Balance.html und Simulator.html sicher

**Dependencies:** `profile-storage.js`

---

## 28. `simulator-engine-wrapper.js` (~110 Zeilen)
Standardisierte Fassade für die Simulationsengine.

**Hauptfunktionen / Exporte:**
- `simulateOneYear()` – Routet Aufrufe zur Direct-Engine-Implementierung
- `getEngine()` – Liefert passende EngineAPI-Instanz
- `getSimulatorFunction()` – Liefert die aktive Simulator-Funktion
- Re-exportiert `initMcRunState` und andere Helpers aus `simulator-engine-helpers.js`

**Features:**
- Performance-Monitoring via Feature-Flags (Elapsed Time Tracking)
- Debug-Logging bei aktiviertem Flag
- Globale Bereitstellung (`window.simulateOneYear`, `window.simulateOneYearDirect`)

**Dependencies:** `feature-flags.js`, `simulator-engine-direct.js`, `simulator-engine-helpers.js`

---

## 29. `simulator-engine-direct-utils.js` (~140 Zeilen)
Utility-Funktionen für die Direct-Engine-Implementierung.

**Hauptfunktionen / Exporte:**
- `euros(x)` – Stellt sicher, dass ein Wert eine nicht-negative Zahl ist
- `computeLiqNeedForFloor(ctx)` – Berechnet benötigte Liquidität für Floor-Bedarf
- `normalizeHouseholdContext(context)` – Normalisiert Haushaltsdaten (p1Alive, p2Alive, widowBenefits)
- `calculateTargetLiquidityBalanceLike()` – Berechnet Liquiditätsziel analog zur Balance-App
- `buildDetailedTranchesFromPortfolio()` – Extrahiert detaillierte Tranchen aus Portfolio
- `resolveCapeRatio()` – Auflösung des CAPE-Ratio aus verschiedenen Quellen

**Dependencies:** `engine/config.mjs`, `engine/analyzers/MarketAnalyzer.mjs`, `engine/transactions/TransactionEngine.mjs`

---

## 30. `monte-carlo-runner-utils.js` (~40 Zeilen)
Konstanten und Hilfsfunktionen für den Monte-Carlo-Runner.

**Hauptfunktionen / Exporte:**
- `MC_HEATMAP_BINS` – Bin-Grenzen für Heatmap-Visualisierung [0, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 10, ∞]
- `pickWorstRun(current, candidate)` – Deterministische Auswahl des schlechtesten Runs
- `createMonteCarloBuffers(runCount)` – Erzeugt typisierte Arrays für MC-Metriken

**Buffer-Typen:**
- `Float64Array`: finalOutcomes, taxOutcomes, stress_CaR_P10_Real
- `Float32Array`: `cutYearShareRatio`, kpiKuerzungsjahre,
  kpiMaxKuerzung, volatilities, maxDrawdowns, etc. Der kanonische
  `cutYearShareRatio` verwendet bei fehlendem Nenner einen endlichen
  0-Platzhalter; `cutYearShareMissingness` unterscheidet ihn zwingend von einem
  beobachteten Nullanteil. JSON serialisiert Missingness als `null`.
- `Uint8Array`: zusaetzlich `cutYearShareMissingness` mit den V1-Codes fuer
  beobachtet, nicht beobachtbar und technischer Fehler
- `Uint8Array`: kpiLebensdauer, depotErschoepft, alterBeiErschoepfung

`MonteCarloPathSummaryV1` ergaenzt `Float64Array`-Werte fuer den realen
Depotentnahme-P10 je Run, `Uint32Array`-Beobachtungszahlen und getrennte
`Uint8Array`-Missingness fuer Haupt- und Stresspfad. Der registrierte
Transferbedarf steigt dadurch von 75 auf 93 Byte pro Run; volle Jahresreihen
und die fruehere `runIdx % 100`-Stichprobe werden nicht uebertragen.

**Dependencies:** keine

---

## 31. `monte-carlo-aggregates.js` (~125 Zeilen)
Aggregation aller Monte-Carlo-Ergebnisse nach Abschluss der Simulation.

**Hauptfunktionen / Exporte:**
- `buildMonteCarloAggregates({ inputs, totalRuns, buffers, heatmap, bins, totals, lists, allRealWithdrawalsSample })`

**Aggregierte Metriken:**
- `finalOutcomes`: P10, P50, P90, P50 (nur erfolgreiche)
- `taxOutcomes`: P50
- `kpiLebensdauer`: Mean
- `cutYearSharePct`: P50, `sampleSize`, ausgeschlossene Runs, inklusive
  10-Prozent-Schwelle und expliziter Zaehler-/Nennervertrag. Der alte
  `kpiKuerzungsjahre`-P50 bleibt nur als deprecated absoluter Jahreszaehler bis
  maximal Slice 11 erhalten.
- `kpiMaxKuerzung`: P50
- `depotErschoepfungsQuote`: Anteil der Läufe mit `isRuin` oder
  Aktien-plus-Gold-Endbestand ≤ 100 Euro;
  `alterBeiErschoepfung`: P50 des ersten entsprechenden Ereignisalters
- `volatilities`: P50 der Stichproben-Standardabweichung (N-1) jaehrlicher
  Portfolio-Renditen ohne zusaetzlichen Annualisierungsfaktor;
  `maxDrawdowns`: davon getrennte P50-/P90-Drawdowns
- `realWithdrawalP10`: kanonischer runbasierter P10/P50-Vertrag mit `sampleSize`, ausgeschlossenen Runs und Missingness-Inventar. `extraKPI.consumptionAtRiskP10Real` bleibt nur als befristeter skalarer Read-Alias fuer bestehende Consumer erhalten.
- `extraKPI.lossCarryTaxSavings`: `total`, `perRunMean`
- `extraKPI.healthBucket`: Nutzungs-/Erschoepfungsquote, Nutzungssummen, Restbucket, Zieldeckung, Zielluecke und Bucket-Zinsen
- `stressKPI`: maxDD, timeShareAbove45, cutYears, `realWithdrawalP10`, recoveryYears; der alte CaR-Skalar bleibt als befristeter Read-Alias markiert
- `extraKPI.pflege.p1` / `.p2`: getrennte Eintrittsquoten mit Zaehler/Nenner sowie bedingte P50-Werte fuer Eintrittsalter, Pflegejahre und realen Mehrbedarf; leere Stichproben sind `null` mit `sampleSize=0` und Missingness-Grund
- `extraKPI.pflege.household`: Pflegequote, simultane Pflegejahre, realer gesamter und maximaler jaehrlicher P1-plus-P2-Mehrbedarf, reale Endvermoegens-Gruppenmediane und bedingte Shortfall-Raten
- `extraKPI.pflege.comparison`: `endWealthNoCareMinusCareRealEur` als ungepaarte, nicht-kausale Gruppenmedian-Differenz; UI-Geldwerte sind real zur Startpreisbasis, nominale Path-Felder tragen `NominalEur`

**Dependencies:** `simulator-utils.js`, `simulator-data.js`, `monte-carlo-runner-utils.js`

---

## 32. `simulator-portfolio-care.js` (~50 Zeilen)
Logik für Pflegedauer-Intervalle nach Geschlecht.

**Hauptfunktionen / Exporte:**
- `normalizeCareDurationRange(minYearsRaw, maxYearsRaw, gender)` – Normalisiert Benutzerintervall mit Geschlechts-Defaults

**Default-Werte (CARE_DURATION_DEFAULTS):**
- Männer (m): 5–10 Jahre
- Frauen (w): 6–12 Jahre
- Divers (d): 5–11 Jahre
- Default: 5–10 Jahre

**Verhalten:**
- Werte ≤ 0 oder NaN werden durch Defaults ersetzt
- Falls min > max, wird max = min gesetzt

**Dependencies:** keine (Pure Logic)

---

## 33. `cape-utils.js` (~55 Zeilen)
CAPE-basierte Startjahr-Filterung für Monte-Carlo-Simulationen.

**Hauptfunktionen / Exporte:**
- `getStartYearCandidates(targetCape, data, tolerance)` – Findet historische Jahre mit ähnlichem CAPE-Ratio

**Verhalten:**
- Strenge Toleranz: ±20% um Ziel-CAPE
- Fallback (< 5 Kandidaten): ±50% Toleranz
- Letzter Fallback: Alle validen Jahre

**Dependencies:** `simulator-data.js` (HISTORICAL_DATA)

---

## 34. `simulator-optimizer.js` (~515 Zeilen)
Auto-Parameter-Optimierung für Sweep-Ergebnisse.

**Hauptfunktionen / Exporte:**
- `findBestParameters(sweepResults, metricKey, maximize)` – Findet optimale Parameter aus Sweep
- `shouldMaximizeMetric(metricKey)` – Bestimmt Optimierungsrichtung
- `applyParametersToForm(params)` – Überträgt Parameter ins Hauptformular
- `displayBestParameters(bestResult, metricKey)` – Zeigt Ergebnis in UI
- `findBestParametersMultiObjective(sweepResults, objectives)` – Multi-Objective (Weighted Sum)
- `findBestParametersWithConstraints(sweepResults, objectiveMetricKey, maximize, constraints)` – Constraint-basierte Optimierung
- `displayMultiObjectiveOptimization(objectives)` – Multi-Objective UI
- `displayConstraintBasedOptimization(objectiveMetricKey, maximize, constraints)` – Constraint-Based UI

**Optimierungs-Modi:**
- Single-Objective: Maximiere/Minimiere eine Metrik
- Multi-Objective: Gewichtete Summe normalisierter Metriken
- Constraint-Based: Optimiere unter Nebenbedingungen (≥, >, ≤, <, =)

**Dependencies:** `simulator-results.js`, `simulator-sweep.js`

---

## 35. `simulator-visualization.js` (~365 Zeilen)
Erweiterte Visualisierungen für Parameter-Sweep-Analysen.

**Hauptfunktionen / Exporte:**
- `calculateSensitivity(sweepResults, metricKey)` – Berechnet Parameter-Sensitivity
- `renderSensitivityChart(sensitivity, metricKey)` – Rendert Sensitivity-Balkendiagramm (HTML)
- `calculateParetoFrontier(sweepResults, metricKey1, metricKey2, maximize1, maximize2)` – Berechnet Pareto-Frontier
- `renderParetoFrontier(paretoPoints, allPoints, metricKey1, metricKey2)` – Rendert Scatter-Plot (SVG)
- `displaySensitivityAnalysis()` – UI-Integration Sensitivity
- `displayParetoFrontier()` – UI-Integration Pareto

**Features:**
- Sensitivity Analysis: Impact-Berechnung (0–100%), Range, normalisierte Darstellung
- Pareto Frontier: Multi-objective Optimization, Dominanz-Prüfung, verbundene Punkte

**Dependencies:** `simulator-results.js`, `simulator-formatting.js`

---

## Modulabhängigkeiten

```
app/simulator/simulator-main.js
  ├─ app/simulator/simulator-monte-carlo.js
  │    ├─ monte-carlo-ui.js
  │    ├─ app/simulator/monte-carlo-runner.js
  │    │    ├─ app/simulator/simulator-engine-wrapper.js
  │    │    │    ├─ app/simulator/simulator-engine-direct.js
  │    │    │    └─ app/simulator/simulator-engine-helpers.js
  │    │    ├─ app/simulator/simulator-portfolio.js
  │    │    │    └─ app/simulator/simulator-data.js
  │    │    ├─ app/simulator/simulator-results.js
  │    │    │    ├─ results-metrics.js
  │    │    │    ├─ results-renderers.js
  │    │    │    ├─ results-formatting.js
  │    │    │    └─ app/simulator/simulator-utils.js
  │    │    ├─ app/simulator/simulator-sweep-utils.js
  │    │    ├─ app/simulator/simulator-utils.js
  │    │    └─ app/simulator/simulator-data.js
  │    ├─ app/simulator/scenario-analyzer.js
  │    └─ app/shared/cape-utils.js
  ├─ app/simulator/simulator-sweep.js
  │    ├─ app/simulator/monte-carlo-runner.js (Mini-Läufe)
  │    ├─ app/simulator/simulator-heatmap.js
  │    ├─ app/simulator/simulator-results.js
  │    ├─ app/simulator/simulator-sweep-utils.js
  │    └─ app/simulator/simulator-utils.js
  ├─ app/simulator/simulator-backtest.js
  │    ├─ app/simulator/historical-backtest-runner.js
  │    ├─ app/simulator/simulator-engine-wrapper.js (injiziert)
  │    ├─ app/simulator/simulator-portfolio.js (Initialisierung injiziert)
  │    └─ app/simulator/simulator-main-helpers.js
  ├─ app/simulator/simulator-ui-pflege.js
  ├─ app/simulator/simulator-ui-rente.js
  ├─ app/simulator/simulator-main-helpers.js
  ├─ app/simulator/simulator-results.js
  ├─ app/simulator/simulator-portfolio.js
  ├─ app/simulator/simulator-heatmap.js
  ├─ app/simulator/simulator-utils.js
  └─ app/simulator/simulator-data.js
```

---

## Datenfluss & Startpunkte

### Monte-Carlo-Simulation
1. `simulator-main.js`: UI-Bootstrap ruft `runMonteCarlo` aus `simulator-monte-carlo.js` auf.
2. `simulator-monte-carlo.js`: Erstellt Generation, AbortController und UI-Fassade, normalisiert Eingaben/Witwen-Optionen und delegiert an den Runner. Start und Cancel sind single-flight; User-Cancel darf keinen seriellen Fallback starten.
3. `monte-carlo-parameters.js`: Validiert Parameter und Ressourcen fuer UI, direkten Runner, Worker und Auto-Optimize identisch; die UI zeigt Kosten und verlangt oberhalb 100.000 Runs eine Bestaetigung.
4. `mc-run-context.js`: Bereitet Chunk-Kontext, RNG, Buffers, Sampling-Basiskonfiguration und Progress-Intervall vor.
5. `mc-year-sampling.js`: Loest `MonteCarloSamplingContractV1` einmal je Chunk auf und liefert Startjahr-/CAPE-Sampling sowie die merge-invariante Ziehungsdiagnostik.
6. `mc-life-events.js`: Initialisiert den Run-Life-State fuer Care-Meta, Partnerstatus, Care-RNGs und HouseholdContext.
7. `tail-risk-overlay.js`: Wendet bei explizitem Opt-in ein deterministisches Tail-Risk-Ereignisfenster auf die gezogenen Jahresdaten an, ohne historische Daten zu mutieren.
8. `mc-stress-tracker.js`: Kapselt Stress-Metrik-Initialisierung, Jahresfortschreibung und Buffer-Schreibung.
9. `mc-log-builder.js`: Baut Ruin-, Jahres- und Todesfall-Logzeilen mit zentralen Alive-/Care-Feldern.
10. `mc-run-metrics.js`: Summiert im Jahresloop reale/nominale Pflege-Mehrbedarfe und schreibt am Run-Ende getrennte P1-/P2-/Haushalts-KPIs, Worst-Runs und `runMeta` fort.
11. `monte-carlo-runner.js`: Führt die reinen Simulationen durch (inkl. Pflege-KPIs) und nutzt `simulator-engine-wrapper.js` für die Jahresschleifen.
12. `monte-carlo-statistics.js` und `monte-carlo-aggregates.js`: Berechnen Wilson-Unsicherheit und reduzieren die global indexierten Depotentnahme-P10-Skalare in Runindex-Reihenfolge.
13. `scenario-analyzer.js`: Zeichnet Worst/Perzentil-/Pflege-/Zufalls-Szenarien waehrend der Runs auf; fruehe Pflege wird fuer P1 und P2 separat ermittelt.
14. `monte-carlo-contracts.js` und `monte-carlo-export.js`: Bauen den tief eingefrorenen Request-/Result-/Provenienzvertrag aus genau diesem Lauf; der Reader prueft Versionen, Pflichtfelder und Fingerprints fail-closed.
15. `monte-carlo-ui.js`: Haelt Start waehrend `running`/`cancelling` gesperrt, fuehrt ARIA-/Fokuszustaende und schaltet nach erfolgreichem Abschluss den V1-JSON-Download fuer die explizite Nutzeraktion frei.
16. `simulator-results.js`: `displayMonteCarloResults()` zeigt Aggregationen und Szenario-Logs an, erneuert nur den dynamischen Inhalt des stabilen `#scenarioSelector` und aktiviert anschliessend ueber `mc-result-cockpit.js` den Ueberblick.
17. `mc-result-cockpit.js`: schliesst das Setup nach Erfolg, synchronisiert den Laufkopf und stellt vor dem Ergebnisfokus die sichtbare Cockpit-Ansicht her.

### Parameter-Sweep
Im Simulator liegt die Exploration im Tab `Parameter-Sweep`; der eigenstaendige
Tab `Auto-Optimize` steht direkt rechts daneben.

1. `simulator-main.js`: Sweep-Button bindet `runParameterSweep()` aus `simulator-sweep.js`.
2. `simulator-sweep.js`: Iteriert über Whitelist-Parameter, nutzt Worker-Jobs (Fallback seriell).
3. `simulator-heatmap.js`: `renderHeatmapSVG()` visualisiert Ergebnisse und
   kennzeichnet Quantilrankings als experimentelle Punktschaetzer.
4. Der Abschlussvertrag ordnet alle sieben sichtbaren Parameter ihrem
   kanonischen Request-Key, Consumer, Wertebereich und Provenienz-Witness zu:
   `liquidityRunwayYears`, `goldRebalancingBand`, `maxSkimPct`,
   `maxBearRefillPct`, `goldTargetPct`, `survivalQuantile` und
   `goGoMultiplier`.
   Dieser Datenpfadnachweis ist kein eigenstaendiger KPI-Wirkungsnachweis.
   Der Browser-Smoke prueft `SweepRequestV1`, `SweepExecutionV2`,
   `SweepMetricsV4` und die Parameterprovenienz eines echten Ein-Zellen-Laufs.
   `minRunwayObserved` ist in V4 das Minimum der kanonischen
   `runway_after_transaction_before_payout_months`; V3 hatte hier trotz der
   Einheit „Monate“ versehentlich `RunwayCoveragePct` in Prozent aggregiert.

### Auto-Optimize

1. `auto_optimize.js` erbt den kanonischen Monte-Carlo-Sampling-, Seed-,
   Startjahrfilter- und CAPE-Vertrag, bewertet Kandidaten mehrphasig und
   veraendert die Eingaben nicht automatisch.
2. Die Ergebnisanzeige enthaelt `AutoOptimizeModelStatusV1` mit
   Evaluation-Modellversion, Jahresdaten-/Regimehash des gesamten
   Datenuniversums, effektiver Startjahr-/Estimated-History-Auswahl,
   `methodClassification=experimental` und getrennten technischen, internen
   und externen Validierungsstatuswerten. Ein Custom-Evaluator wird getrennt
   ausgewiesen und erbt keine eingebauten Datenhashes.
3. Der Champion ist der beste gefundene Szenariokandidat im untersuchten
   Suchraum. Er ist weder ein globales Optimum noch eine fachlich validierte
   Strategie oder Finanzempfehlung.
4. Die interaktive Suche besitzt sechs Dimensionen: Liquiditaets-Runway,
   Goldziel, Gold-Rebalancing-Band, maximale Skim-Quote, Survival-Quantil und
   Go-Go-Multiplikator. `maxBearRefillPct` bleibt eine Sweep-Dimension;
   `targetEq`, `runwayTargetMonths`, `runwayMinMonths` und `rebalBand` sind
   keine aktuellen Optimizerparameter.

### Liquiditaets-Runway

`types/liquidity-runway-contract.js` ist die gemeinsame Quelle fuer Default,
Bereich, Schrittweite, Migration und abgeleitete Policy. UI, Profile, Sweep,
Optimizer und Engine verwenden `liquidityRunwayYears`; Legacy-Daten werden in
der Reihenfolge kanonischer Wert, `runwayTargetMonths`,
`runwayMinMonths`, Default 5 migriert. Dabei werden ganzzahlige Altwerte
der frueheren UI-Domains zuerst auf das naechste Sechsmonatsraster aufgerundet,
sodass kein gespeicherter Puffer verkuerzt wird. Der effektive Nettojahresbedarf
ist die nach allen Spending-Policies und der Monatsquantisierung final geplante
Portfolioauszahlung. Das
Netto-Runway-Ziel wird daraus und `liquidityRunwayYears` berechnet. Unabhaengig
davon bildet `minCashBufferMonths` (0 bis 12, Default 2) eine Brutto-Untergrenze
aus Floor plus Flex vor Rentenverrechnung; das auf volle 100 EUR aufgerundete
Liquiditaetsziel ist das Maximum beider Groessen. Der interne Pre-Policy-Runway
wird an den SpendingPlanner uebergeben. Getrennt davon verwendet die
Dynamic-Flex-Safety nach der Transaktion weiterhin den ungekürzten nominalen
Nettojahresbedarf, damit eine Spending-Kuerzung nicht selbst die gemessene
Safety-Reichweite erhoeht. `dynamicFlexSafetyRunwayBasis` nennt diesen Vertrag
als `pre_policy_annual_net_need`; das historisch benannte Exportfeld
`safety_runway_post_months` transportiert diesen Wert. Das Exportfeld
`safety_runway_pre_months` bezeichnet dagegen den post-policy,
pre-transaction Runway. Jahreslogs, Backtest-KPI und Monte-Carlo-Jahreszeilen
messen den Bestand nach Transaktionen und vor Jahresauszahlung.
`RunwayMeasurementPhase = after_transaction_before_payout`,
`runway_after_transaction_before_payout_months` und `RunwayCoveragePct`
benennen diesen kanonischen Messpunkt. Nicht anwendbare Zieldeckung bleibt
`null`; terminale Ruin-/Todeszeilen erfinden keine Null-Prozent-Beobachtung.
`RunwayCoveragePostPayoutEndOfYearPct`,
`runway_post_payout_end_of_year_months` und `liq_post_payout_end_of_year`
bewahren die Phase nach Auszahlung explizit als Diagnose;
`safety_runway_post_months` und `liqEnd` behalten ihre alte Bedeutung.
Ueberschuesse bedienen das separate
Goldziel und danach Aktien nur bis zum expliziten Skim-Budget, ohne eine feste
Aktienquote wiederherzustellen. VPW gewichtet die tatsaechliche Aktien-, Gold-
und Liquiditaetszusammensetzung.

### Profilverbund und Demografie

Finanzielle Werte ausgewaehlter Profile koennen haushaltsweit aggregiert
werden. Der V1-Demografiecontract modelliert jedoch hoechstens zwei Personen:
ein Primaerprofil und optional ein Sekundaerprofil. Bei mehr als zwei
ausgewaehlten Profilen bleibt die Simulation lauffaehig, zeigt aber die
Warnung, dass die Demografie auf zwei Personen begrenzt ist. Zusaetzliche
Profile sind deshalb keine zusaetzlichen individuellen Mortalitaets-,
Pflege- oder Rentenpfade (D-16).

### Backtest
1. `simulator-main.js`: Backtest-Controls triggern `runBacktest()` aus `simulator-backtest.js`.
2. `historical-backtest-ui.js`: Projiziert Provider-Bounds, validiert Periode/Cohort-Horizont und aktualisiert Status-/Fehlerregionen.
3. `simulator-backtest.js`: Liest normalisierte DOM-Inputs und nutzt den gecachten Historical-Data-Provider.
4. `historical-backtest-runner.js`: Fuehrt die DOM-freie Jahresschleife mit eigenen Laufkopien und injiziertem `simulateOneYear()` aus; optional erzeugt `historical-backtest-cohorts.js` das feste Fensterinventar.
5. `simulator-backtest.js`: Haelt das immutable Resultat und dieselbe Row-Instanz fuer Summary, Tabelle und Export; `historical-backtest-ui.js` projiziert Status, Warnungen, Cohorts und Tabellensemantik.
6. `historical-backtest-export.js`: Erzeugt nach explizitem Klick das versionierte Raw-JSON oder die feste technische CSV-Projektion ohne Abhaengigkeit vom sichtbaren Detailmodus.

---

## Szenario-Log-System

Nach jeder Monte-Carlo-Simulation werden bis zu 31 Szenarien gespeichert:

### Bis zu 16 Charakteristische Szenarien
- **Vermögensbasiert:** Worst, P5, P10, P25, Median, P75, P90, P95, Best
- **Pflege-spezifisch:** Worst mit Pflege, laengste Pflegedauer, hoechster realer Pflege-Mehrbedarf sowie fruehester Eintritt P1 und P2 (soweit beobachtet)
- **Risiko:** Längste Lebensdauer, maximale Kürzung

### 15 Zufällige Szenarien
- Gleichmäßig über alle Runs verteilt
- Zeigen typisches Simulationsverhalten

### Speicherung
- Alle Log-Zeilen pro Szenario
- Metadaten: Endvermögen, Failed-Status, Lebensdauer, Pflege-Status
- Export als JSON/CSV möglich
- Detaillierter Logmodus zeigt additive Entnahme-/Payout-/VPW-Spalten. Normalmodus und bestehende Export-Shapes bleiben kompatibel.

---

## Init-Pfade & erwartete Schnittstellen

- **App-Bootstrap:** `initializeUI()` in `simulator-main.js` bindet Buttons/Hotkeys und ruft alle Setup-Funktionen. Erwartet, dass DOM-IDs aus `Simulator.html` existieren.
- **Pflege-UI:** `initializePflegeUIControls()` in `simulator-ui-pflege.js` setzt Preset-/Badge-Logik auf. Erwartet Felder `pflegeStufe*`, `pflegeMaxFloor`, `pflegeKostenStaffelPreset` und zeigt/hide Panels per Checkbox `pflegefallLogikAktivieren`.
- **Rentenquelle:** `initRente2ConfigWithLocalStorage()` in `simulator-ui-rente.js` sperrt zentrale Personenwertträger ohne Altkeyleser oder Persistenzlistener. Die bestätigte Migration gehört zu `profile-person-migration.js`; Haupt-/Partnerprojektion und dokumentlokale Alternativen zu `simulator-person-overrides.js`. Partneranzahl folgt der Profilauswahl.
- **Sweep-Voreinstellungen:** `initSweepDefaultsWithLocalStorageFallback()` in `simulator-sweep.js` lädt Defaults, liest `localStorage` und setzt Guardrails (Whitelist/Blocklist). Erwartet Zugriff auf Sweep-Formularfelder und das Toggle.
- **Backtest-Setup:** `initializeBacktestUI()` in `simulator-backtest.js` verknuepft Zeitraum-, Start-, Cohort-, Detail- und Raw-Downloadcontrols per idempotenter Modulbindung. `historical-backtest-ui.js` erwartet die Status-, Hint-, Fehler-, Notice-, Cohort- und Tabellen-DOM-IDs des Backtest-Tabs; die Jahresschleife selbst liegt in `historical-backtest-runner.js` und ist DOM-/Persistenz-frei.
- **Monte-Carlo-Start/Lifecycle:** `runMonteCarlo()` in `simulator-monte-carlo.js` liest `mcAnzahl`, `mcDauer`, `mcBlockSize`, `mcSeed`, `mcMethode`, `mcStartYearMode`, `mcStartYearFilter`, `mcStartYearHalfLife` sowie Progress-UI (`mc-progress-bar*`). Jeder Lauf erhaelt eine eindeutige Generation; `cancelMonteCarlo()` terminiert aktive Slots, verwirft spaete Antworten und laesst Replacement bis zum naechsten Start aus. Nur ein nicht abgebrochener aktueller Lauf liefert aggregierte Ergebnisse an `displayMonteCarloResults()`.
- **Startjahr-Sampling:** `mc-run-context.js` bereitet die Basiskonfiguration vor; `mc-year-sampling.js` kapselt `FILTER` (harte Grenze), `RECENCY` (Half-Life), `UNIFORM`, CAPE-Kandidaten und `MonteCarloSamplingContractV1`. CAPE hat vor Gewichtung Vorrang. Das gewaehlte Startjahr ist fuer Fixed-/Stationary-Block sowie Markov/IID das erste tatsaechliche Marktjahr; ignorierte Optionen und Fallbacks bleiben im Vertrag sichtbar.
- **Samplingdiagnostik:** Direktlauf und Worker transportieren `MonteCarloSamplingDiagnosticsV1` mit Samplingvertrag, Datenfingerprints, Startjahr-/Jahres-, Quellen-, Regime-, Stationary- und Tail-Risk-Zaehlern. `monte-carlo-chunk-result.js` validiert und merged diese Zaehler unabhaengig von Chunkreihenfolge.
- **Life-State:** `mc-life-events.js` initialisiert Care-Meta, Partnerstatus, Care-RNGs und HouseholdContext. Die Jahreslogik bleibt im Runner-Hot-Path, bis eine vollstaendige Extraktion den Benchmark stabil erfuellt.
- **Schaetzer und reale Depotentnahme:** `monte-carlo-statistics.js` liefert Wilson-95-Prozent-Intervalle fuer die binaere Floor-Deckung sowie die laufgewichtete Aggregation eines realen Depotentnahme-P10-Skalars je auswertbarem Run. Direkter und Workerpfad transportieren P10, Beobachtungszahl und Missingness indexiert; eine volle Jahresreihe wird nicht gemerged.
- **Stress-Metriken:** `mc-stress-tracker.js` kapselt Portfolio-Drawdown, Quote-Above-4.5, Cut-Years, runbasierte reale Depotentnahme P10 und Recovery-Years fuer Stress-Presets. Nullauffuellung nach Ruin endet am Stressfenster beziehungsweise am Tod des Haushalts.
- **Logzeilen:** `mc-log-builder.js` vereinheitlicht Ruin-, Jahres- und Todesfall-Logs. Builder laufen nur fuer tatsaechlich geloggte Runs. Backtest-Logs und Monte-Carlo-Scenario-Logs verwenden dieselbe Semantik fuer Entnahme-/Payout-/VPW-Felder.
- **Run-Metriken:** `mc-run-metrics.js` kapselt Ergebnisbuffer, getrennte Pflege-Listen und -Zaehler, den realen/nominalen Pflege-Mehrbedarf, Safety-Run-Zaehler, Worst-Run-Auswahl und `runMeta`.

---

## Platzierung neuer Features & Helfer

- **UI-spezifische Logik (Formular, Presets, Tooltips):** In thematischen UI-Modulen (`simulator-ui-pflege.js`, `simulator-ui-rente.js`) oder generisch in `simulator-main-helpers.js`. `simulator-main.js` sollte nur die Verkabelung übernehmen.
- **Simulation / Domain-Logik:** Pflege-/Renten-/Stressberechnungen gehören in `simulator-engine-helpers.js`, `simulator-engine-direct.js` oder `simulator-portfolio.js`. Monte-Carlo-spezifische Steuerparameter in `simulator-monte-carlo.js`. Sweep-spezifische Regeln in `simulator-sweep.js` bzw. `simulator-sweep-utils.js`.
- **Rendering & Exporte:** Tabellen-/CSV-/Heatmap-Aufbereitung in `simulator-results.js`, `simulator-heatmap.js` oder `simulator-main-helpers.js` (falls UI-nah). Backtest-Display in `simulator-backtest.js`; versionierte Backtest-Rohvertraege ausschliesslich in `historical-backtest-export.js`.
- **Gemeinsame Utilitys:** Statistik/Formatierung bleiben in `simulator-utils.js`. Objekt-Transforms/Clones mit Bezug zu Sweeps oder Renten-Invarianz in `simulator-sweep-utils.js`.
- **Neue Buttons/Flows:** Im UI-Bootstrap (`initializeUI()`) verdrahten und direkt den passenden Modul-Export aufrufen, statt Logik-Blöcke in `simulator-main.js` zu platzieren.

---

## Entwicklungstipps

1. **Neue Features:** Direkt im passenden Fachmodul implementieren (siehe oben) und nur über `initializeUI()` verkabeln.
2. **Pflege-Logik:** In `simulator-engine-helpers.js`. UI-Anteile nach `simulator-ui-pflege.js` auslagern.
3. **Neue KPIs:** In `simulator-results.js` (`displayMonteCarloResults`, `createKpiCard`) oder bei Sweep-spezifischen KPIs in `simulator-heatmap.js`.
4. **Persistenz/Helper:** Gemeinsame Formatter/Downloads in `simulator-main-helpers.js`, Sweep-Clones in `simulator-sweep-utils.js`.
5. **Tests:** `npm test` für Regressionstests und Pflege-Logik.
6. **

---

**Last Updated:** 2026-08-15

## Darstellungsvertrag der Eingabefelder (Designsystem, Slice 4)

- `simulator-main-dynamic-flex.js` synchronisiert die gemeinsamen Balance-/Simulator-
  Zustände an seinen bisherigen Refreshbedingungen. Fachliche Nichtanwendbarkeit
  von Horizont/Quantil erzeugt keine zusätzlichen Sperren oder Wertänderungen.
- `simulator-main-profiles.js` ergänzt Herkunft an den bestehenden Locks und
  Cashanzeigen. `profileFieldOrigin` dient nur der Darstellung. Die nachfolgende
  Profilsperre von `rentAdjPct` bleibt an ihrer bisherigen Stelle.
- `simulator-main-rent-adjust.js` und `simulator-main-partner.js` exportieren zusätzlich reine Refreshfunktionen
  für Herkunft/Gründe nach der Profilübernahme. Insbesondere entscheidet
  `refreshRentAdjustmentPresentation` weder über `disabled` noch Sichtbarkeit.
- `simulator-main-3bucket.js` und `simulator-ui-pflege.js` ergänzen Gründe am
  sichtbaren Strategiefeld, Pflegeschalter und Modellfeld. `monte-carlo-ui.js`
  stellt die bereits entschiedene Bootstrapblockgrößen-Anwendbarkeit dar.
- `simulator-portfolio-display.js` ergänzt neutrale Herkunft an abgeleiteten
  Beständen und Kennzahlrollen an den bestehenden `.calculated-display`-Ankern.
  Berechnung und Formatierung bleiben unverändert.

Verborgene Legacyfelder, Einheiten, Recovery-/Busy-Blockaden, Akkordeons und
Legendenlistener bleiben erhalten. DOM-freie Bestandsmocks ohne Dokument/Eltern
führen weiterhin die bisherigen Entscheidungen aus; die neue DOM-Matrix und die
registrierten Browserfälle prüfen die tatsächliche Darstellung separat.
Nachweise: `tests/designsystem-simulator-fields.test.mjs`,
`tests/simulator-ui-orchestration.test.mjs` und Browserfall
`Designsystem simulator fields` mit Haushalts-/Reload-/Recoveryerweiterungen.

### Ergebnisdarstellung mit Designsystem (Slice 5)

`buildSummaryData` liefert für warnungsfreie Floor-Deckung `tone: 'default'`,
einschließlich beobachteter 0/1 Prozent. Der bestehende `small_sample`-Zweig und
fehlende/technisch gesperrte Werte bleiben `warning` mit unverändertem Grund.
Alle Werte, Intervalle, Quantile und Stichproben bleiben aus denselben Aggregaten.

`renderSummary` zeigt vorhandene Beschreibungen sichtbar; Summary-/KPI-Karten
behalten ihre eigenen Klassen mit additiven `ds-card ds-metric`-Rollen.
`stress-replay-renderer.js` ergänzt Karten-, Tabellen-, Reiter- und Meldungsrollen
an denselben IDs/Dataankern. Logzahlen und Exportverträge bleiben unverändert;
`simulator-results.js` verwendet Tokenfarben für positive/negative Handelstexte.
Zahlen sind Sans/tabellarisch; bestehende Druckpanelregeln bleiben erhalten.

Nachweise: `designsystem-simulator-results.test.mjs` (vollständige Basis-Viewmodel-
Digests und Quell-/Markupgegenproben), `results-metrics.test.mjs`,
`results-renderers.test.mjs`, `stress-replay-renderer.test.mjs` sowie der
registrierte Browserfall `Designsystem simulator results`.

### Werkzeugfarben und Grafikverträge (Designsystem Slice 6)

Die Renderer `simulator-portfolio-chart`, `simulator-heatmap`,
`simulator-optimizer`, `simulator-visualization` und `auto-optimize-renderer`
verwenden die gemeinsamen Text-/Diagrammrollen aus `css/tokens.css`.
`app/shared/designsystem-chart-colors.js` löst die Heatmap-Stützwerte aus dem
Dokument oder einer injizierten aufgelösten Tokenmap auf und interpoliert
Hell → Messing → Schiefer. Der Exportname `viridis` bleibt kompatibel; ohne
Dokument liefert er CSS-Ausdrücke statt einer zweiten festen Hex-Palette.
Opake Labelplatten sichern Haupttext auf surface nach kritischer Überlagerung
und Warnrand. Datenverträge, Geometrien und Warn-/Übernahmeentscheidungen bleiben
identisch. Sweep-/Paretohosts und `.ao-param-*` bleiben erhalten; Designsystem-
Klassen sind additiv, dynamische Input-/Selectrollen werden am DOM ergänzt.

Nodebelege: `designsystem-charts`, `designsystem-tools`, `simulator-heatmap` und
die bestehenden Sweep-/Auto-Optimize-/Backtestverträge. Die Grafikprojektionen
und Championtexte sind an Basis `d6edc965` gebunden. Der registrierte Browserfall
`Designsystem tools` prüft Backtest (zwei Jahre), Sweep (vier Kombinationen,
zwei Läufe, zwei Jahre) und Built-in-Optimize (ein fixierter Parameter, 100 Läufe,
ein Train-/ein Bestätigungsseed, zwei Jahre über die bestehende readConfig-
Injektion des UI-Handlers). Die Produktvorgabe von 35 Jahren bleibt unverändert.


### Simulatoranzeige und Scrollregionen (Designsystem Slice 9)

Die Simulatorpanels verwenden `simulator-panel / inline-size`; neue Spalten
beziehen sich auf die Panelfläche und besitzen schrumpfbare Kinder.
Heatmap, Portfolio, Sensitivität und Pareto behalten ihre Koordinaten/Mindestbreiten
in benannten Tastaturregionen. Logs sowie Optimierer-/Replaytabellen scrollen
lokal. Druck öffnet wie bisher die Ergebnis-/Replaypanels und
blendet nur die neuen Fortsetzungshinweise aus.

Die gemeinsame Volltexthilfe `app/shared/designsystem-selection-text.js` hält
`<id>-fulltext` synchron bei jeder programmatischen Auswahländerung aktuell:
Nach der Bindung delegieren instanzbezogene `value`- und `selectedIndex`-Accessoren
an die ursprünglichen DOM-Accessoren und lesen den tatsächlich ausgewählten
Optionstext. Initialisierung und Optionsrefresh erfassen Werte vor der Bindung;
`change` und der MutationObserver bleiben für Benutzereingaben und Optionsänderungen.
`option.selected` in `profile-manager.js` wird durch den bestehenden expliziten
Refresh am Ende von `renderProfiles` erfasst. Der Reset von `reconciliationForm`
führt über `clearReconciliationPreview` und `renderReconciliationState` zum
bestehenden expliziten Refresh in `renderReconciliationOptions`. Die anderen
Formular-Resets (`trancheForm`, `stressReplayVariantEditor`) treffen keine Selects
mit Volltext; der Varianteneditor vergibt auch nachträglich keine Select-IDs.
Leere Auswahl ergibt leeren Volltext. Globale DOM-Prototypen, Fachwerte,
Optionsentscheidungen, Sperren, Speicher und fremde `aria-describedby`-Bezüge
bleiben erhalten; die Hilfe erzeugt keine künstlichen `input`-/`change`-Events.
Node-DOM-Tests sichern die Produktpfade und scheiternde Settergegenproben ab;
die registrierten Browserfälle prüfen native Setter samt Indexgegenprobe,
Profilwechsel/Reload, Preset/Custom und den Reset nach Abgleichbestätigung.

Die additive UI-Grenze `formatDisplayFixed` ersetzt den Dezimalpunkt erst nach
der bestehenden `toFixed`-Rundung. `formatDisplayScalar` rundet Parameter nicht.
SVG-Koordinaten, Inputwerte, Parser und technische Exporte bleiben numerisch.
Fehlende Sweepzellen zeigen — statt des Palettenminimums; Null, N/A/Grund,
kleine Anteile <0,1 % und vorhandene ∞-Intervallgrenzen bleiben getrennt.
Konservative Cent-/Drawdownwerte, Einheiten, Laufzahlen und Warnungen bleiben gleich.
Portfolio nennt nominale Euro und den Pflegebucketausschluss am vorhandenen Host.

Der abgeschlossene Quellvertrag erfasst alle fünf Seiten und benannten Renderer;
Bestandsausnahmen sind einzeln in `docs/design/designsystem.md` begründet.
Nodebelege: `designsystem-layout`, `designsystem-data-display`, `designsystem-charts`,
`designsystem-tools`, `simulator-heatmap`, `results-renderers`, `stress-replay-renderer`
sowie die unveränderten Parser-/Exporttests. Die registrierten Browserfälle
`Designsystem simulator layout`, `Designsystem tools` und
`Designsystem simulator results` messen 1366/1920/2560 px mit Fokus und Druck.
Ihre Ausführung liegt außerhalb der Agentensandbox; Registrierung ist keine Abnahme.

Der kurze Werkzeug-Browserfall kann eine konstante Sensitivitätsmetrik liefern.
In diesem Fall füllt ausschließlich die Sensitivitätsanzeige eine synthetische
Varianzfixture; echte Sweepdaten, Ranking und Übernahme bleiben unverändert.

Dynamische `.ao-param-key`-Selects erhalten eine stabile additive ID und ein
zugeordnetes Label für den Auswahlvolltext. Bestehende Klassen, `data-param-id`,
Domainlistener und numerische Min-/Max-/Stepwerte bleiben erhalten.


## Suite-Kontextanzeige

`#suiteContext` bündelt aktive Profilidentität, aktuelle Haushaltsauswahl und `simulatorContextPills` im Suite-Kopf. Der Renderer kopiert die Profilidentität nicht erneut. „Letzter Lauf“ beschreibt den gespeicherten Berechnungsumfang; Zeitraum und tatsächliche Veraltetheit bleiben aus demselben Laufmodell erhalten. „Gerechnet mit“ wird beim Haushaltswechsel weiterhin nicht umetikettiert.

`simulator-main-profiles.js` meldet die von seinem bestehenden Auswahl-/Limitpfad
bestimmten Profile an `renderSuiteHousehold`. Die Anzeige trifft keine eigene
Mitgliedschafts- oder Aggregationsentscheidung; Recovery bleibt neutral.

Die Leistenpräferenz `ui_suite_sidebar_collapsed` ist reine Geräte-UI und gehört
weder zu Profilen noch zu Bundles, Fachbackups oder Snapshots. Unter 82rem
äußerer Containerbreite ist die Leiste automatisch kompakt; darüber gilt die
manuelle Wahl. BFCache-Rückkehr widerruft alte Freigaben und führt den `pageshow.persisted`-Reload
erst nach erneuter Schutzentscheidung und bestätigtem Flush aus.


## Rahmennavigation (Paket 2a, Slice 3)

Der frühere Inhalts-Startlink entfällt. Übersicht und Handbuch im Rahmen verwenden
den zentralen delegierten Handoff; der separate Hilfelink öffnet weiterhin nativ
einen neuen Tab. Haupttabs, Profil-/Haushaltsauswahl, Resultat- und Druckanker
bleiben erhalten. `Suite frame navigation replacement` prüft den ersetzten
Rückweg mit Maus/Enter und gehaltenem Flush; `Suite frame print` und `Suite frame widths`
prüfen die endgültige Struktur. Browser-/Layout-/BFCache-/EXE-Abnahme ist extern
offen; Navigationsschutz ist angeschlossen, Ergebnisablage folgt erst in 4.2.


### Navigationsschutz – Paket 2b, Slice 2: Validierung

`tests/simulator-monte-carlo.test.mjs` und `tests/simulator-sweep.test.mjs`
betreiben die echten UI-Handler mit kontrollierter Vorbereitung/Abschlussarbeit,
echten Pools und kontrollierten Workerinit-/Jobantworten. Sie prüfen
Idempotenz, seriellen Fallback/Signal, Spätupdates, Abbruch vor Publikation,
Ergebnisgrund und gemeinsames Warten auf beide Besitzer. Der MC-Signaladapter
wird zusätzlich mit einem erfolgreichen fest gesäten bisherigen seriellen Lauf
über alle zurückgegebenen Ergebnisdaten verglichen. Die bestehenden
`tests/worker-parity.test.mjs` und `tests/worker-lifecycle-isolation.test.mjs`
schützen fachliche Parität und Workercleanup.

Browserfall `Navigation guard calculations` in `tests/browser-smoke.test.mjs`:
echte kleine MC-/Sweep-Läufe, kontrollierte Vorbereitung und MC-UI-Cleanup,
Bleiben mit anschließend erfolgreicher Rechnung, wirklicher MC-Download,
Ergebnisnachfrage am fokussierten Rahmenlink mit Enter und beide Abbruchenden
vor Export/Flush/Linkwechsel. Kein künstlicher Schutzprovider.
Der Fall ist registriert und syntaxgeprüft; sein Start in der Agentensandbox
scheitert mit `listen EPERM`. Browserabnahme durch die gesteuerte Sitzung bleibt
erforderlich. Die volle Node-Suite führt ausschließlich der Orchestrator aus.

## Geschützter Simulatorreset

`initResetButton` erhält die bestehende Bestätigung. `reloadGuardedPage` fragt
vor dem Entfernen der `sim_*`-Keys und `clearHouseholdSimulatorNeeds` nach allen
Verlustgründen und wartet Abbruchenden ab. Der eigene Commit bleibt durch den
abschließenden Flush gesperrt. Der Haushaltsmarker verhindert weiter Legacyimport.
`createResetReloadController` nutzt den optionalen Statusvertrag von `guard.reload`:
Vorbereitungsfehler vor Mutation liefern `cancelled`, erhalten den Rahmenabbruchhinweis
und erzeugen weder Resetflush noch neue Sperre oder falsches Speicherfehlerlog.
Flush-false/Ausnahme liefert `failed` am sichtbaren `simProfileStatus`. Nach bestätigtem
Flush ohne Reload (neue Eingabe, fremder Commit oder Reloadcallbackfehler) liefert der
Handler `reload_required` und zeigt dort „Reset gespeichert“, „nicht neu geladen“,
Reloadaufforderung und den Hinweis auf nicht mehr gespeicherte Eingaben.
Ab Mutationsbeginn sperrt die Facade Set/Remove aller bestehenden und neuen `sim_`-Keys
sowie Haushaltsmarker und Warnungsquittierung. `initInputPersistence` fängt
`PERSISTENCE_RELOAD_REQUIRED` auch beim Haushaltsautosave ab, zeigt den Hinweis und
veröffentlicht keine persistierte Erfolgsbaseline. Der Marker bleibt
`profile_default`/`reset`, die Warnungsquittierung entfernt. Die Sperre gilt bis zum
Dokumentwechsel, auch nach dem Reloadcallback. Eine explizite bestätigte Wiederholung
bestätigt nur den ausstehenden Flush und versucht Reload ohne erneute Resetmutation.
Erfolg lädt einmal ohne Profilbundleexport; keine neue Rollbackgarantie. Ergebnisse
bleiben flüchtig, Downloads quittieren Verlustgründe nicht; Ergebnisablage folgt erst
in 4.2. Node: `simulator-ui-orchestration`, `simulator-household-needs-persistence`,
`persistence-write-navigation`, `navigation-guard-reload`; Browser:
`Navigation guard resets and recovery` (externe Ausführung erforderlich).


## Profilsicherung beim Verlassen (Paket 2b, Slice 1)

Der gemeinsame Unterseiten-Lifecycle in `app/profile/profile-navigation.js`
beginnt bei `beforeunload` zusätzlich früh den synchronen Profilsnapshot und den
asynchronen Facadeflush. Genau ein dauerhafter Speicherlistener verändert weder
`defaultPrevented` noch `returnValue`; nur der zentrale, verlust-/commitabhängige
Nachfragehandler schützt native Browserwege. Pagehide und Hidden behalten ihren
Capture-Snapshot vor dem Facade-Bubbleflush. Das ist keine Garantie für den
asynchronen Abschluss beim Entladen. Während eines dokumenteigenen Commitgrunds
oder einer aktiven Facade-Schreibsperre beginnt der unabhängige Profilpfad weder
Saver noch eigenen Flush; Besitzerflushes bleiben zulässig. Dirty-/Ergebnisgründe
und abgelehntes Verlassen verhindern spätere Profilsicherung nicht.

### Fortsetzung: Backtest und vier MC-Ergebnisse

Die Backtestkarten behalten Periodenvalidierung, kanonische Status-/Kennzahlen,
Norm-/Detailspalten und Raw-Exporte. Rolling Cohorts erscheinen nach dem Log.
`renderKpiDashboard(container, dashboard, riskContainer)` zeichnet Hauptwerte und
nominale/reale Drawdowns im Überblick, die unveränderten Detaildeskriptoren im
`#riskKpiDashboard`. Stress wird daneben unter `#mcViewPanelRisk` erzeugt;
Heatmap, Pflegegruppen und Logs behalten ihre eigenen Hosts.
`bindResultInfoPopups()` bindet neue MC-Erklärungen mit Hover, Fokus, Klick,
Escape/Rückfokus und Außenklick ohne neue Finanzsemantik.
Druck öffnet die MC-/Werkstattahnen, geschlossenes Setup, vier Ergebnisansichten
und drei Replayvergleiche. Sweep-/Optimize-Werkzeuge werden samt vorhandenen
Ausgaben auch mit `hidden` gedruckt; geschlossene Annahmenschritte bleiben geschlossen.

## Werkstatt und finaler Simulatorworkflow (Paket 4b, Slice 3)

Fünf Hauptreiter: Ergebnis, Annahmen, Backtest, Monte-Carlo, Werkstatt. Die
Werkstatt besitzt genau drei Tools und initial keinen offenen Rechner.
`#workshopToolCards` bleibt mit drei Auswahlkarten sichtbar. Die aktive Karte
zeigt eine Messingtönung und „Schließen“ mit synchronen ARIA-Zuständen.
Pfeile/Home/End wechseln zwischen den Karten; es gibt keine zweite Auswahlleiste. Replay, Sweep und
Optimize bleiben in `#workshopReplayPanel`, `#tab-sweep`, `#tab-auto-optimize`;
Wechseln/Schließen verändert keine Inputs, Resultate, Controller oder Exporte.
Der Replaybadge zählt im Replaykopf nur Alternativen, keine Baseline.

`#sweepRanges` bündelt sieben editierbare Tabellenzeilen. Laufzahl, nominelle
Arbeitslast, Anwendbarkeit und Start-/Abbruchregeln bleiben unverändert.
Heatmap, führende Kombination/Übernahme, Sensitivität und Pareto verwenden
weiterhin die kanonischen Metriken und Rankings. Optimize bietet sieben
Presets sowie 1–7 Blöcke aus sechs Parameterarten; Min/Max/Schritt, Ziel/Quantil,
Train-/Testseeds, Flexmodus und vier Nebenbedingungen bleiben erhalten.

Alle Toolcontrols und dynamischen Parameterblöcke tragen gemeinsame `ds-`-Rollen.
Diagrammtexte nutzen 14-px-Token bei nativer Mindestbreite mit benannter lokaler
Scrollregion. Druck bleibt CSS-gesteuert: MC-Setup, vier Ergebnisse und drei
Replayvergleiche sind unabhängig vom sichtbaren Werkzeug erreichbar. Sweep und
Auto-Optimize werden samt vorhandener Heatmap/Pareto beziehungsweise
Championausgabe auch mit `hidden` und bei inaktivem Werkstatt-Hauptreiter gedruckt. Werkzeugkarten und Navigation
entfallen im Druck; Grafik-, Overflow- und Stickyregeln bleiben erhalten.
Medienwechsel verändern weder DOM-Werkzeugwahl noch Fokus. Die Browserfälle
`Simulator.html` und `Designsystem tools` prüfen diese Matrix; ihre Ausführung
außerhalb der Agentensandbox bleibt erforderlich.
Schutznachfragen, Profil-Handoff und BFCache bleiben unverändert.

Gezielte Nodebelege prüfen Hosts, Werkzeugwechsel/Fokus, Abbruch und unveränderte
Resultatprojektionen. Browsermatrix, Referenzvergleich 16–18 bei 1920/2560 px,
Gesamtvergleich 1920/3440 px, Druck und Kandidaten-EXE stehen extern aus.
S01–S73 sind mit endgültigen Orten im Funktionsinventar geführt; dessen
Bestandsbelege sind keine neue Laufzeit- oder Designfreigabe.

### MC-Karte und Werkstatt nach Referenzen 11–18 (Paket 4e)

Die MC-Karte bündelt dynamische Zusammenfassung, „Einstellungen anzeigen“,
Abbruch, Fortschritt und Fehler. Die Startaktionen stehen in der Ergebniskarte und in „Einstellungen“ des Monte-Carlo-Reiters. „Ergebnis exportieren
(JSON)“ steht erst beim veröffentlichten Ergebnis bereit. Vier MC-Ansichten
und vollständige Erklärungen im Druck bleiben erhalten. Hauptreiter verwenden
Unterstrich und kräftige Schrift mit separatem Fokusindikator.

Während der Rechnung blendet `syncMonteCarloRunControls()` den Start und „Einstellungen ändern“
in der Ergebniskarte aus; Fortschritt und Abbruch bleiben sichtbar. Nach Ende, Abbruch oder Fehler
kehren beide Aktionen zurück. Der Hinweis auf den manuellen Erststart steht nur ohne Ergebnis und laufende Rechnung.

`simulator-workshop-ui.js` bindet pro Dokument einmalig; die Auswahlkarten bleiben
sichtbar, Öffnen/Schließen ändert nur Anzeige, ARIA und Fokus. Der Rücklink aus
Szenario-Logs aktiviert Werkstatt und denselben Replayhost. Replay hat eine äußere
Karte mit drei nummerierten Schritten, Sweep und Optimize jeweils eine äußere Karte.
Dynamische Min-/Max-/Schrittlabels beziehen ihre Einheiten aus der vorhandenen
Parameterregistrierung und aktualisieren sie beim Parameterwechsel.
Die Node-Nachweise ersetzen keine externe Browser-/Bild-/Druckabnahme.

### Jahresband und Erststart der Übersicht (Paket 6, Slice 3)

Die Übersicht projiziert ausschließlich gespeicherte Werte; Jahresband und
Willkommen starten keine Simulatorrechnung. Die Übersicht zeigt keine
Durchspielen-Karte; der Simulator bleibt über die Seitenleiste erreichbar.
`#backtest`, `#monte-carlo`, `#annahmen` und `#werkstatt` bleiben zulässige Ziele. `activateSimulatorTab` aktiviert nach Bereitschaft die Ansicht,
der vorhandene einmalige Startbacktest bleibt beim Simulator. Ein leerer
Defaultbestand bietet Personendialog und Vollimport, keine Demo und keine neuen
Simulationsparameter oder Ergebnisrecords.


## Gemeinsame Protokollmodule (P7, Slice 1)

- `simulator-monte-carlo.js`: Ergebnisflag und Revision gehören zur bestehenden
  dokumentbezogenen Guardregistrierung. Nur deren eigener Lauf liefert eine aktive
  Phase; der Singleflight-Controller bleibt modulweit. Erstabbruch in einem neuen
  Dokument erzeugt keinen fremden Ergebnisgrund. Abbruch/Fehler eines Folgelaufs
  erhalten das verfügbare alte Ergebnis desselben Dokuments und dessen Schutz.
- `protocol-columns.js`: `PROTOCOL_COLUMNS`, `PROTOCOL_GROUPS`, `getProtocolColumns()`,
  `readProtocolValue()` und `formatProtocolValue()` bilden den einzigen aktiven
  Anzeigekatalog. Er verbindet flache MC- und verschachtelte Backtestzeilen, enthält
  die bisherigen Detail-/Pflegefelder und trennt Gold-/Drei-Bucket-Anwendbarkeit.
- `protocol-renderer.js`: `renderProtocolTable()`, `protocolYearPresentation()`,
  `renderProtocolSummary()` und `renderProtocolLegend()` erzeugen DOM-frei die
  gemeinsame sichere Darstellung. Keine Kürzung von Datentexten, kein HTML aus
  Rohfeldern; Jahr-/Alterskontext kommt aus dem gerechneten Lauf. Gruppengrenzen
  stehen auch zwischen Einzelköpfen und Zellen; Sticky-Köpfe liegen über den Daten.
  Die normale Reichweitenspalte heißt „Liquidität reicht“. `failed=false` liefert
  „Kein Ruin“, keine Aussage über einen unzensierten Lebensabschluss.
  „Niedrige Entnahme“ steht nur in der sichtbaren Spalte `withdrawal`, auch nach
  Umordnung und bei Legacy-Spalten aus dem Katalog; andere Entnahme-/Rentenspalten
  erhalten kein Kennzeichen. Hinweis in Titel und `aria-label`: „Reale Entnahme unter
  dem 10-%-Wert aller simulierten Jahre (CaR)“. Verglichen wird ausschließlich
  `jahresentnahme_real < caRThreshold`, beide Werte endlich. MC reicht den bestehenden
  Laufwert `realWithdrawalP10.realEur` durch; der Backtestadapter akzeptiert eine
  ausdrückliche Schwelle im Anzeigekontext, berechnet keine und übernimmt keine globale
  MC-Schwelle. Ohne Schwelle oder sichtbare Entnahme kein Chip. Rohzeilen und JSON/CSV
  bleiben unverändert. Aktien-, Gold- und Bondverkäufe verwenden in beiden Hosts
  `--text-main`, Käufe weiterhin `--accent`; Richtungswörter und Vorzeichen bleiben erhalten.
- `simulator-results.js`: `renderWorstRunLog()` und `getWorstRunColumnDefinitions()`
  bleiben schmale Adapter; der zweite erhält alte Kopfkennungen für bestehende
  Aufrufer. `displayMonteCarloResults()` ersetzt Listener und setzt Export-/Replayaltpfade
  zurück. Ein zusätzliches `displayContext.startYear` kommt vom erfassten MC-Laufstart.
- `simulator-backtest.js`: Protokollkontext aus `result.request`; Detailschalter und
  beide unveränderten Downloads befinden sich im gemeinsamen Kopf. Rohdownload und
  Anzeige bleiben unabhängig. `simulator-main-helpers.js` erhält den alten nicht
  aktiven Rohformatzweig für Kompatibilität, sein Anzeigezweig delegiert an den Katalog.
- `stress-replay-renderer.js`: verwendet den gemeinsamen Geldformatter lesend und
  behält Jahresvergleich, Varianten, Deltas und Replayexports.

`backtestLogDetailLevel`, `worstLogDetailLevel`, `logDetailLevel` (Lesefallback) und
`showCareDetails` bleiben unverändert. Serializer, Simulation, RNG und Terminalsemantik
wurden durch diesen Anzeigeumbau nicht geändert. Prüfungen und offene Browser-/Bild-
und Plattformgates stehen in `docs/design/p7-protokolle-validierung.md`.


## Szenarioverläufe und Endwertverteilung (P7, Slice 2)

- `scenario-log-view.js`: `bindScenarioLogView()` bindet Gruppen, Listbox, Navigation
  und SVG an dieselbe Auswahl. `disposeScenarioLogView()` entfernt alte Listener beim nächsten
  Ergebnis. `renderScenarioList()` zeigt Vermögen, Pflege, Risiko und bis zu 15 Stichproben
  als gleichwertige Optionszeilen in jeweils einer aktiven Gruppe. Zeilenstrich und Linie teilen die Farbe,
  Endwert beziehungsweise Ruinjahr steht rechts; die Auswahl bleibt messinghell.
  Der gemeinsame Maßstabschalter ist flüchtig; Moduswechsel verändert weder Auswahl noch Protokollquelle.
- `scenario-wealth-chart.js`: `buildScenarioEntries()` erhält Analyzer-Schlüssel und
  Quellobjekte; `buildScenarioWealthPath()` projiziert Startwert und beobachtete
  `portfolio_total_end`-Jahreswerte. Direkte Legacy-Helferaufrufe behalten die
  Jahresbeginnbasis. `renderScenarioWealthChart()` verwendet stets den Jahresendfaktor
  `inflation_factor_cum * (1 + inflation / 100)`, unabhängig von `wealthFan` und
  `fan.available`. Fehlende oder ungültige Inflation bleibt eine reale Lücke; nominale
  Rohwerte bleiben sichtbar. Ruin endet bei 0, Tod erzeugt keinen weiteren Finanzpunkt.
  `formatScenarioWealthTick()` rundet ausschließlich Y-Ticktexte auf deutsche
  Kurzwerte ohne Cent. Die große Fläche nutzt 470 px Höhe und Diagramm/Liste 2:1;
  bei kleinen Breiten stapeln sie sich mit lokalen Scrollflächen.
  P16c Slice 1 misst die Host-Inhaltsbreite ohne Padding; native Maße und viewBox
  stimmen überein (Breite × 470). Ab 768 px passt das Chart, darunter scrollt eine
  lokale Mindestbreite von 760 px. Resize zeichnet nur die Grafik, auch nach
  Sichtbarwerden; Observer und Fensterlistener werden beim Rebind entfernt.
  Die rechte Liste ist auf Grafik samt Legende begrenzt, scrollbar und mit
  Fokus/Scrollhinweis versehen. Namen und rechtsbündige Werte bilden die erste
  Zeile, Personendetails eine umbrechende Folgezeile. Vermögensnamen enthalten
  keinen redundanten Pflegezusatz; beobachtete Pflegeereignisse bleiben sichtbar.
  Die Basisachse folgt dem beobachteten P95-Pfadmaximum im aktiven Modus. Ersatz:
  übrige Vermögenspfade ohne Best, danach P95-Jahresbänder, Start beziehungsweise 1
  als sicherer Zeichenmaßstab. Jede Auswahl darf erweitern; Rückwahl reduziert.
  Plot, Fächer, Endmarken und Trefferflächen teilen einen eindeutigen Clip.
  Überragende Pfade erhalten echte Maxima mit Euro und Namen als auswählbare
  Randmarken in einem eigenen scrollbaren SVG-foreignObject. Die gewählte Linie
  liegt zuletzt und kräftig, übrige sind gedämpft. Gruppen steuern Strichmuster.
  Vier Gruppenumschalter mit tatsächlichen Anzahlen ersetzen Select und Chips.
  Das SVG besitzt Titel/Beschreibung; die Listbox ist die zugängliche Alternative. Liste und `scenarioEndWealth` lesen `realByRun[absoluteRunIndex]`
  desselben Quelllaufs wie die Linie; bei vollständigen Beobachtungen stimmen die
  realen Endwerte überein.
- `wealth-distribution.js`: `buildWealthDistribution()` liest nominal ausschließlich
  `finalOutcomes.distribution.values`, real `wealthView.realValues`. Der Aggregator
  kopiert dafür die vorhandenen vollständigen Pflege-/Nichtpflege-Endwertlisten;
  `wealthView.realByRun` erhält als nicht serialisierter Ansichtszusatz den globalen Quellindex aus den bereits
  vorhandenen Pfadzusammenfassungen (auch bei Tod vor dem ersten Finanzjahr);
  nur bei passender Beobachtungszahl ist die Realverteilung verfügbar. Keine pauschale
  Inflationsumrechnung. Ruin kommt aus Outcome, erfolgreiche Nullendwerte bleiben
  reguläre Finanzfälle. Die Achse nutzt P97,5 ausschließlich positiver Endwerte
  im gewählten Maßstab, mindestens 1.000 € (auch ohne positive Werte). Bins und
  Prozentnenner zählen weiter alle Finanzfälle einschließlich erfolgreicher Nullwerte;
  Restbalken und Hinweis erscheinen nur bei echtem Rest. Bei P10 = 0 steht der
  Alltagssatz „In mehr als 10 % der Läufe ist das Vermögen aufgebraucht.“.
  Neun nominal ausgewählte Szenariomarken behalten im Realmaß ihre Quellidentitäten;
  Leiterabstände können negativ sein und werden vor Rundung berechnet. Der Satz
  verwendet bestehende nominale KPIs beziehungsweise interpolierte Realperzentile.
- `results-renderers.js`: zeigt die unveränderte 4,5-%-Berichtsreferenz als Zeile
  innerhalb „Weitere Kennzahlen“, ohne Duplikat im Risiko-Host.
- `simulator-results.js`: behält Protokoll-, Detail-, Pflege-, Export- und Replayvertrag;
  die neue Ansicht steuert nur die aktuelle Auswahl. `wealthView` ist Anzeigezusatz,
  kein Bestandteil der bestehenden RunResult-/Downloadprojektion. Alte Ergebnisse
  ohne Realbeobachtungen bleiben nominal lesbar. Der Fächerhost nutzt kompatible Jahreszähler; bei alten oder fehlenden Daten
  bleibt der erklärende Platzhalter statt erfundener Bänder.

Nachweise: `scenario-log-view`, `scenario-wealth-chart`, `wealth-distribution` sowie
unveränderte Ergebnis-/Statistik-/Exportprüfungen; Browser und Bildvergleich bleiben
getrennte externe Gates gemäß `docs/design/p7-protokolle-validierung.md`.


## Jahresfächer und Großlaufhinweis (P7, Slice 3)

`wealth-fan-aggregation.js` beobachtet nur den MC-Ergebnispfad, opt-in mit
`collectWealthFan: true` im seriellen MC-Aufruf und als oberstes Feld jeder
MC-Jobnachricht. Der gemeinsame Worker aktiviert den Fächer ausschließlich bei
`message.collectWealthFan === true`; ohne Feld, mit `false` oder anderen Werten
erzeugt und überträgt er keine Fächerpuffer. Sweep/Optimize und Lognachmaterialisierung bleiben ohne
Zusatzbeobachtung. Laufweise O(Horizont) temporäre Jahresdaten werden erst nach
fachlichem Abschluss gezählt; technische Pfade liefern nur technische Missingness.
Start ist eine eigene Anfangsbeobachtung. Ruin zählt Nullvermögen, weitere lebende
Ruinjahre kommen ausschließlich aus der bestehenden Post-Ruin-Lebensfortsetzung.
Todesjahr und Replay-Schattenfortsetzung liefern keine zusätzliche Finanzbeobachtung.

`WealthFanV1` verwendet feste Null-/Unter-/Log-/Überlaufklassen: 1-Euro-Untergrenze,
1,01-fache Grenzen bis mindestens 10^12 Euro, linksgeschlossen/rechtsoffen.
Negative/nicht endliche/nicht numerische Werte sind Missingness, nicht Null.
P5/P25/P50/P75/P95 verwenden den bestehenden (n−1)*p-Interpolationsrang,
geometrische Klassenmitten und interpolierte Klassenunter-/obergrenzen. Reguläre
Schätzungen liegen innerhalb 1 %; Unter-/Überlaufquantile haben keine Schätzung.
Fehlende Inflation bleibt ausdrücklich fehlend, nominale Beobachtungen bleiben nutzbar.

Zwei Uint32-Matrizen (real/nominal) plus vier Jahresvektoren (lebt, ruiniert,
real/nominal fehlt) kosten `(Horizont+1)*(2*Klassen+4)*4` Bytes, unabhängig von
der Laufzahl. Die Zusammenführung hält eine Gesamtmatrix und keine Fächermatrix
je abgeschlossenem Chunk. Nach erfolgreichem Workermerge entfernt der Consumer
die Quellmatrix auch aus dem Chunkcontainer (`releaseWealthFan`), damit noch
gehaltene Race-/Poolpromises keine abgeschlossenen Matrizen bewahren. Nur dieser Zusatzaggregator hat konstanten Speicher;
bisherige Ergebnis-/Metadatenpuffer wachsen weiter. Überlauf-/Dimensions-/
Summenprüfungen und eindeutige Transferbuffer gehören zum Zusatzvertrag.

`wealth-fan-chart.js` liefert Bänder, Median, Startreferenz, Endmarken und
Lebens-/Ruinleiste sowie den blassen Szenariohintergrund. Der Fächer endet
**strikt unter 5 %** lebenden Haushalten bezogen auf fachlich gültige Ausgangsläufe.
Realwerte beziehen sich auf Jahresendpreise relativ zum Laufstart: Die Szenariolinie
verwendet stets den Log-Jahresbeginnfaktor mal beobachteten Jahresinflationsfaktor,
auch ohne Fächer oder bei inkompatiblen Zusatzdaten im Platzhalterzustand. Fehlende
oder ungültige Inflation erzeugt reale Lücken statt Ersatzwerte; Rohlogs, nominale
Werte und direkte Legacy-Helferaufrufe bleiben unverändert. Start und Jahrespositionen
sind gemeinsam; der Real-/Nominalschalter aktualisiert alle drei Vermögensansichten.
Fehlende/inkompatible Zusatzdaten ergeben den Referenz-02-Platzhalter des Fächers,
ohne die Preisbasis der Szenariolinien zu ändern.
`wealthFan` am Anzeigeaggregat ist nicht aufzählbar/serialisiert; kein Zusatzexport.

`monte-carlo-run-hint.js` liefert ab 100.000 Läufen einen Hinweis, verstärkt ab
1.000.000. Dauer wird nur aus dem letzten vergleichbaren erfolgreich veröffentlichten
Lauf nach Run-Jahren skaliert; Compare-/Fallbackläufe liefern keine Mischgrundlage.
Ohne Grundlage bleibt sie unbekannt. Wilson-95 stammt aus
`buildBinaryProportionEstimate`; ohne Deckungsanteil wird konservativ 50 % benannt.
Der einmalige Binder in `monte-carlo-ui.js` betätigt `mcButton` und erfüllt beim
bewussten Hinweisklick die bestehende Großlaufbestätigung; Reset setzt nur
`mcAnzahl` über dessen bisherigen Inputweg. Lauf, Fehler, Doppelklick und Neu-Render
bleiben beim selben kanonischen Controller, Maximum 1.000.000. Messgrundlage
und Zusatzdaten sind rein flüchtig; Abbruch/Fehler ersetzen keine erfolgreiche Messung.

SOURCE-Nachweise und externe Gates: `docs/design/p7-protokolle-validierung.md`.

### Werkstattbedienung und Medienprüfung (Paket 4f, Slice 1)

`selectWorkshopTool()` aktiviert bei Werkzeugwahl zuerst den bestehenden
Werkstatthauptreiter und schaltet dann ausschließlich die drei vorhandenen Hosts.
Replay, Sweep und Optimize sind direkte Geschwister unter `#tab-werkstatt`.
Öffnen/Schließen sowie Pfeile/Home/End erhalten Arbeitsstände und Controller;
Schließen gibt den Fokus zum Kartenknopf zurück. Kein Rechenstart oder Abbruch
ist an die Wahl gebunden. Ein statischer Ahnenbeleg ersetzt keine Browsermessung
von `display`, `visibility` und Layout.

Der Browser prüft die Bildschirmwahl samt Ahnen vor und nach dem Medienwechsel.
Unter Druck bleiben alle drei Inhalte und vorhandene Ausgaben unabhängig von
Werkzeugwahl und Hauptreiter sichtbar; Auswahl, `hidden`, Arbeitsstand und Fokus
werden nicht geändert. Die frühere widersprüchliche Bildschirmassertion liegt
jetzt außerhalb des Druckblocks. Die externe Browser-/Bildabnahme bleibt offen.

Strategieparameter liegen in Annahmen, Schritt 3 „Strategie“; die fünf Schritte
heißen „Wer und womit“, „Bedarf“, „Strategie“, „Personen und Rente“, „Pflege“.
`mcButton` startet in „Einstellungen“ des Monte-Carlo-Reiters; die Ergebniskarte bietet denselben Start ohne Reiterwechsel. Die Beschriftung lautet vor dem ersten Erfolg „Monte-Carlo rechnen“, danach „Monte-Carlo neu rechnen“.
`exportMonteCarloRunJson` heißt „Ergebnis exportieren (JSON)“.
„In Replay anzeigen“ öffnet denselben Werkstatthost, „Auswahl in Szenario-Logs
ändern“ führt zurück. Der E2E-Fall beobachtet weiter einen echten abgeschlossenen
Lauf und verlangt ein sichtbar gerendertes „95-%-Konfidenzintervall“.

Werkstatt-Druckprüfung: Bildschirmwahl und Ahnen gelten auch für Replay. Die
Druckmatrix erhält echte Sweep-/Pareto-/Optimize-Ausgaben unabhängig von Werkzeug
und Hauptreiter; ein leerer `ao_result`-Host ist noch keine Ausgabe. Der Medienwechsel
verändert keine DOM-Auswahl und startet keine Controller. Die Szenarioexportprobe
publiziert B vor dem regulären Ergebnisbinden; unbekannte nachträglich hinzugefügte
Selectoptionen bleiben ungültig. V2-Projektion erfolgt erst beim JSON-/CSV-Export.


## Zentrale Personenquelle und persistente Modellannahmen

`simulator-profile-inputs.js` projiziert `profile-person-data.js` für denselben Januar-/Planungsjahrbezug wie Balance. Haupt- und Partnerprofil liefern ihre eigene Rente, Kirchensteuer und SPB vor dem bisherigen Merge; gemeinsame Rentenanpassung und gewichtete Haushaltskirchensteuer bleiben erhalten. Die allgemeine Inputpersistenz, Renteninitialisierung und Partnersteuerung erzeugen keine entfernten Personen-`sim_*`-Keys. Hinterbliebenen-, Langlebigkeits-, Pflege-, Strategie- und Rechenparameter bleiben eigene Modellannahmen. DOM-freie numerische Runner behalten Startalter plus Jahresindex, Seeds und Fachformeln. Sichere Umstellung, Altaliases und vollständiges Feldinventar stehen in TECHNICAL.

Für die Rentenprojektion gilt [Rente ab Rentenbeginn (Paket 10d)](#rente-ab-rentenbeginn-paket-10d): Im Startjahr der Entnahme ist die Eigenrentenauszahlung einschließlich des bestätigten Beginnmonats anteilig; die volle Jahresbasis wird weiterhin ab Index 0 fortgeschrieben. Die dort beschriebenen Nullauszahlungen in Ansparjahren und der Simulatorfallback ohne Datum gelten weiterhin.

### Flüchtige Personenalternativen und Laufbeleg

`simulator-person-overrides.js` besitzt die Dokumentbaseline, die tatsächlichen Profilidentitäten und den ausschließlich flüchtigen Entwurf. Die Personenkarte zeigt Hauptprofil und Partner getrennt; `simPersonEditLink` nutzt den bestehenden bestätigten Handoff nach `depot-tranchen-manager.html#personendaten`. Normalmodus sperrt alle Personenfelder, versteckte Aliase und Segmentknöpfe. Ein alternativer Geburtstag liefert das Januaralter; Alter und Rentenoffset sind keine eigenen editierbaren Quellen. Der Moduswechsel verwirft Alternativen, Profilwechsel/Reset/Reload ebenso. Der Reset löscht nur Modellkeys; Personenfelder und noch vorhandene zentrale Altquellen bleiben unverändert. Rentenanpassung nach Hauptprofil, SPB-Summe und bisherige Kirchensteuergewichtung bleiben erhalten.

`simulator-input-pension.js` liest die effektive Projektion vor dem Haushaltsmerge. `simulator-portfolio-inputs.js` bindet den eingefrorenen `personDataContext` in einer WeakMap an die gelesenen numerischen Inputs. Metadaten werden nicht in Engine-/Workerrequests oder RNG übernommen. `simulator-run-assumptions.js` nimmt den Beleg in den separaten Laufkopf auf; MC, Backtest, Sweep und Optimizer erfassen ihn bei Start. Fertige Ergebnis-/Protokollhinweise und Downloads verwenden ihren eigenen Laufbeleg, nicht den späteren Entwurf.

MC-Roh-JSON, Szenario-/Worst-/Pflege-JSON/CSV, Backtest/Kohorten-JSON/CSV und Replay-JSON/CSV erhalten additive Kontextfelder. CSV ergänzt `personDataReferenceYear`, `personDataDeviationApplied`, `personDataChanges`. Bisherige Finanzspalten und Altdateien ohne Kontext bleiben erhalten. Exportfingerprints berücksichtigen den Beleg. Replay-Workspaces mit tatsächlichen Personenalternativen bleiben dokumentlokal, einschließlich Varianten und importierter abweichender Workspaces; reguläre Replaypersistenz bleibt bestehen.

Abnahme: `simulator-person-overrides.test.mjs`, `simulator-run-assumptions.test.mjs`, produktive MC-Laufbinder in `simulator-monte-carlo.test.mjs`, Ergebnisrebind/Blobdownloads in `scenario-log-view.test.mjs` und vorhandene Exportvollständigkeitsorakel. Browserfälle 05/06 erweitern den vorhandenen Personendatenfall; tatsächlicher Browserlauf und Bildvergleich liegen bei der Steuerung.


### Export- und Abschlussgrenze (Paket 10, Slice 4)

Der Personenbeleg Version 1 nennt `referenceYear`, `ageRule: january-1-completed-years`, `deviationApplied`, tatsächliche Profil-IDs/Rollen und Feldänderungen mit Profil-/wirksamem Wert. Gemeinsame Rentenanpassung folgt dem Hauptprofil; dormante fixe Sätze erzeugen keine Abweichungsbehauptung. Jahresoffset aus Rentenbeginn, Kirchensteuer-Prozent/Ratio und Monats-/Jahresrente behalten die in TECHNICAL dokumentierten Einheiten.

MC V2 (neben lesbarem V1), Szenariolog V2, Backtest-/Kohorten- und Replay V1 behalten vorhandene Pflichtfelder und vollständige Finanzspalten. Personenfelder sind additive Metadaten außerhalb von RNG und numerischem Request. Szenario-CSV bewahrt die sortierte Recordschlüsselunion, Backtest seine bisherigen Spalten und Replay `workspace`/`comparison`; hinzu kommen `personDataReferenceYear`, `personDataDeviationApplied`, `personDataChanges`. Der JSON-/CSV-Download und Ergebnisrebind verwenden den eigenen eingefrorenen Lauf, auch nach neuer Eingabe oder Ausschalten. Handbuch erklärt Normalmodus, zentralen Änderungslink, flüchtige Alternativen und getrennte Profilsicherung. Browser-/Bild-/WebView-/Windows-Abnahme bleibt bis externer Ausführung offen.

### Startreihenfolge und Rechenbereitschaft (Paket 10b)

`simulator-main-init.js` übernimmt Haushalts-/Personenprofile vor dem ersten gemeinsamen Rechenleser. `simulator-portfolio-display.js` benötigt ausschließlich Vermögens-/Strategie-/Tranchenwerte. `simulator-main-profiles.js` nutzt den gemeinsamen DOM-freien Bereitschaftsadapter: fehlender Geburtstag ohne Altalter sperrt sämtliche Rechenaktionen mit derselben Begründung, ohne technische Recovery. `readPensionInputs()` liefert den erwartbaren Unvollständigkeitsstatus ohne Throw; `getCommonInputs()` verhindert damit Engine-/Workerrequests. `simulator-auto-backtest.js` signalisiert `skipped` vor Validierung/Engine. Vorhandene Ergebnisse bleiben vorhanden, unbeteiligte Außenprofile sperren nicht, der leere Erststart erhält den Dokumentstandard ohne Profilgeburtstag.

`tests/simulator-person-readiness.test.mjs` führt die echte UI-Initialisierung mit Registry-only und identischen Livekeys aus: 67/64, tatsächliche Wertträger, Haushaltsanzeige und erreichter Öffnungs-Backtest. Fehlende Haupt-/Partnerdaten, Außenprofile, Altalter und leerer Erststart sind Gegenproben. Der Aufschubtest führt ebenfalls den produktiven Start aus und belegt bytegleiche Records ohne schreibende Defaults-/Persistenz-Hooks. „Person data readiness“ ist als Browserfall registriert; Browser und Bildabnahme bleiben bei der Steuerung.

Nach ausdrücklich bestätigter erfolgreicher Personenmigration erhält `initSimulatorProfileSelection()` den benannten Ergänzungslink auch für eine Außenperson ohne Geburtstag/Altalter. Der gemeinsame Hinweisadapter hält den bestätigten Folgehinweis ausschließlich für die Lebensdauer des Dokuments und verbindet ihn mit der aktuellen Bereitschafts-/Altalterbegründung. Ein vollständiger Haushalt bleibt ohne Personen-/Recoveryblocker und mit freigegebenen Rechencontrols. Aktuelle Außenprofile und konfliktfreie automatische Migration erzeugen keinen bestätigten Hinweis; ein frisches Dokument übernimmt ihn nicht. Die Darstellung schreibt keine Records, erzeugt keine zusätzlichen Snapshots und hält keinen Navigationsschutz offen. Speicherformat, Mitgliedschaft und Rechensemantik bleiben unverändert. Die Node-Starttests prüfen die echte bestätigte Transaktion mit anschließender produktiver Auswahl und beide Gegenfälle. Der Browserfall „Person migration followup“ prüft dieselben Fälle für Startseite und Simulator erst nach abgeschlossenem Start; sein tatsächlicher Lauf erfolgt außerhalb der Agentensandbox.

## Rente ab Rentenbeginn (Paket 10d)

Bei fehlendem Rentendatum ist ein positiver migrierter Versatz an `profile_person_migration_v1.referenceYear` gebunden: Beginn ist der 01.01. des Referenzjahres plus ursprünglichem Versatz. `projectPerson()` liefert `max(0, referenceYear + renteStartOffsetJahre - year)`, vor Beginn null Rentenmonate/-betrag und ab Beginn zwölf Monate. Positive Versätze ohne gültige datierte Herkunft werden kontrolliert abgewiesen. Fehlender oder nullwertiger Versatz bleibt mit laufender Zwölfmonatsrente kompatibel; sonstige Einkünfte wirken stets unabhängig ganzjährig. Projektion verändert keine Profil- oder Migrationbytes.

Der Simulator erhält die originale Monatsrente, den im jeweiligen Planjahr wirksamen Versatz und zwölf Startmonate. Referenzjahr 2026 mit Versatz 2 ergibt 2026/2027/2028/2029 die Versätze 2/1/0/0 und Balance-Jahresrenten 0/0/12.000/12.000 bei 1.000 monatlich. Ein bloßer Januarvorschlag ersetzt kein bestätigtes Datum. Ein expliziter Beginn hat Vorrang, einschließlich Juli-Teiljahr mit sechs Monaten. Kalender- und Betragsfehler bleiben kontrollierte Fehler.

`profile-person-data.js` leitet mit `deriveAnnualPension` die Rentenmonate des Planungsjahres rein aus dem ISO-Kalenderdatum ab: Bei bestätigtem Datum gelten vor dem Beginnjahr null Monate, im Beginnjahr `13 − Beginnmonat`, nach dem Beginnjahr zwölf Monate. Der Beginnmonat zählt vollständig, auch bei Beginn am 15. Juli (Juli = sechs Monate). Ohne Datum liefert diese Kalenderfunktion zwölf Monate; bei datiertem Migrationsbeginn setzt `projectPerson` Monate und Jahresrente nur vor dem Startjahr auf null, danach gelten zwölf Monate. Ungültige Kalenderdaten und Beträge werden abgewiesen. Der gespeicherte Monatsbetrag bleibt die erwartete Nettorente in heutigen Werten nach Kranken- und Pflegeversicherung.

Die Balance verwendet den wirksamen Jahresbetrag und zeigt dessen Monatsdurchschnitt. Sonstige Einkünfte bleiben unabhängig ganzjährig im Budget. Sync, Reader, Haushaltsaggregation, Verteilung und Summary rechnen mit demselben Anteil; Statushinweise nennen in Haushalten die Person. Profilwechsel und ein abgeschlossenes Planungsjahr aktualisieren die rein abgeleitete Anzeige ohne Profilwrite.

Der Simulator transportiert `renteStartMonate` für Hauptperson und Partner zusätzlich zum Jahresoffset. Ohne Zusatz gelten zwölf Monate. Die volle Jahresbasis wird weiterhin ab Index 0 angepasst; im Entnahmejahr wird nur die Eigenrentenauszahlung am Startindex anteilig, danach vollständig verwendet. Partnersteuerquote und Hinterbliebenenregeln bleiben erhalten. In jedem Ansparjahr sind `rente1`, `rente2`, `renteSum` und `pension_annual` exakt null, auch bei belegtem Kalenderbeginn: Die tatsächlichen externen Wertflüsse bleiben Cashzins und Sparrate. Cash am Jahresende entspricht Anfangscash plus Cashzins und Sparrate abzüglich Aktien- und Goldkäufen. `renteKalenderbeginn` wirkt in der Ansparphase ausschließlich auf das Liquiditätsziel und damit auf die Cash-/Kaufverteilung. Dafür zählen die zeitanteiligen, voll fortgeschriebenen Eigenrentenbasen; beim Partner gilt `rente2BruttoEigen` vor seiner Steuerquote. Bei vollem Kalenderfaktor entspricht diese Zielbasis dem Altpfad, auch mit positiver Partnersteuerquote. Historische Requests ohne Kalendermarker behalten ihre bisherigen Ziele und Wertflüsse. Die Nullspalten kürzen keine Rentenbasis: Das erste Entnahmejahr verwendet die unverändert fortgeschriebene volle Basis und die bisherigen Renten-/Steuerregeln. Protokoll sowie JSON-/CSV-Exporte übernehmen die tatsächlichen Jahreswerte einschließlich der Ansparnullen ohne erneute Kürzung oder Ersatzwerte. Ein späterer Personenentwurf verändert fertige Laufbelege nicht.

Bei der gesicherten Umstellung bleibt die Profilquelle grundsätzlich vorgeschlagen. Nur Profilbetrag null oder altes explizites Nein zusammen mit positiver Simulatorrente und Startoffset größer null erhält den Vorschlag „künftige Rente aus dem Simulator“. Betrag und Offset müssen derselben Person und Live-/Registryquelle entstammen. Vorschlag, Dialogvorauswahl und unveränderte Übernahme stimmen überein; explizite Profilwahl und Abbruch bleiben möglich. Ein gültiges vorhandenes Datum bleibt erhalten; bei fehlendem Datum bleibt Januar des Referenzjahres plus Offset lediglich der gekennzeichnete Vorschlag, kein erfundener Juli.

Node-Nachweise: `profile-person-data.test.mjs` (Kalenderregel, Zeitzonen und vollständiger synthetischer Altpfad-Bytevergleich), `balance-person-data-readonly.test.mjs` (produktive Eingänge, Engine, Summary und Bestandsschutz), `simulator-household-pension.test.mjs` (Eigenrenten, Anpassung, Partner, Ansparen und Monte Carlo), `historical-backtest-export.test.mjs` (realer Backtest, Protokoll und Export), `profile-person-migration.test.mjs` (Vorschlag, Readback, Reload und Abbruch). Browserfälle „Rentenbeginn Kalenderbudget“ und „Künftige Rentenquelle Umstellung“ sind registriert; Browserausführung und externe Bild-/Bedienabnahme bleiben bis zur tatsächlichen Ausführung offen. Das separate gepinnte Charakterisierungsgate bleibt unverändert und wird auf Linux nicht ausgeführt.

## Gespeicherte Abschlussaussagen auf der Startseite (Paket 13)

`simulator-overview-summary.js` friert vor Rechnung Profilumfang, relevante
Quellenfingerabdrücke und effektive Laufannahmen ein. Backtest schreibt ausschließlich
`completed`/`ruin` mit Zeitraum, gegebenenfalls Fehljahr und kanonischem realem
Endvermögen. MC schreibt nach vollständigem finanziellen Inventar, Nachlauf,
`finishProgress` und letzter Abbruch-/Generationsprüfung. Median/P5 stammen aus der
vollständigen nominalen Endpopulation einschließlich Ruin und erfolgreicher Nullwerte,
ohne Pflegereserve; fehlende Werte bleiben fehlend. Der Erfolgsanteil bleibt die
Floor-Deckung des bestehenden Outcomeinventars.

Der erfolgreiche Werkstattvergleich zeigt eine vergleichbare Alternative gegen
Baseline auf demselben hypothetischen Pfad; zuletzt bearbeitete Alternative hat
Vorrang, sonst die letzte in `variantOrder`. Kein Baseline-only-/Fehlervergleich
und kein bloßes Speichern erzeugt eine Aussage. Was-wäre-wenn bleibt gekennzeichnet.

Werkstattabschlüsse entstehen nur durch einen expliziten erfolgreichen Vergleich
mit vergleichbarer Alternative und passendem Herkunftsbeleg. Dieser dokumentlokale
Beleg wird am Beginn des ursprünglichen Monte-Carlo-Laufs an dessen Inputs gebunden
und erst nach erfolgreichem Fixieren dem Arbeitsstand zugeordnet. Vor dem Vergleich
müssen Fingerabdruckversion, Profilidentität, Haushaltsumfang und Quellenbasis noch
passen; Änderungen während des Vergleichs erhalten die eingefrorene Basis und
machen den gespeicherten Abschluss veraltet. Ein neuer MC-Kontext etikettiert keinen
alten Arbeitsstand um. Öffnen und Import rechnen den Vergleich weiter, ersetzen
aber weder Abschlusszeitpunkt noch Quellenfingerabdruck. Nach Reload/Import fehlt
der Beleg: Auch „Neu berechnen“ und Variantenänderungen erhalten dann den letzten
Übersichtserfolg. Für einen neuen Übersichtseintrag einen neuen MC-Lauf fixieren und
eine Alternative vergleichen. Replay, Exporte und Persistenzfelder bleiben gleich.
Bereits früher falsch gestempelte Einträge werden nicht repariert, da ihre
ursprüngliche Quellenbasis nicht zuverlässig rekonstruierbar ist.

Die profilbezogene Ablage `overview_simulation_summary_v1` verwendet den abgesicherten
Writer in `overview-storage.js`, mit Navigationsbesitzer bis Flush und bedingtem
Rollback. Fehler der Ablage verändern kein Fachresultat. Startseite/Reload lesen
nur gespeicherte Ergebnisse, mit deutschem Abschlussdatum und ehrlichen Einheiten;
wirksame Quellenänderungen zeigen „Veraltet – neu rechnen“. Profilwechsel,
Snapshot, Vollbackup und Profilbundle erhalten die Einträge.


### P16, Slice 1: vereinfachte Simulator-Eingaben

Monte-Carlo startet direkt in der Ergebniskarte „Reicht das Vermögen?“ oder mit `mcButton`
in der Karte „Einstellungen“ des Monte-Carlo-Reiters, auch bei geschlossenen Optionen.
Beide Knöpfe heißen zunächst „Monte-Carlo rechnen“, nach erfolgreichem Lauf „Monte-Carlo neu rechnen“.
`initializeResultOverview()` delegiert beide Starts an denselben `runMonteCarlo` ohne Reiterwechsel;
nur „Einstellungen ändern“ in der Ergebniskarte öffnet den Monte-Carlo-Reiter. Der bestehende
Run-Guard verhindert Doppelläufe. Beide Hosts spiegeln Vorbereitung, Prozentfortschritt,
fertig gerechnete Läufe, Auswertung, Abbruch und Fehler aus einem dokumentlokalen UI-Zustand.
Der Zähler stammt aus fertig gerechneten Läufen beziehungsweise abgeschlossenen Workerchunks;
Auswertung und seriell/paralleler Vergleich werden als Phase bezeichnet und nicht in Läufe umgerechnet.
Ein Neurender der Ergebniskarte erhält Bedienung und Zustand. Abbruch oder Fehler erhalten den
letzten erfolgreichen Ergebnisstand; Änderungen der Annahmen markieren ihn wie bisher als veraltet.
Nicht berechenbare Backtest-Kürzungen nennen den Grund, etwa „Nicht vergleichbar: Entnahmebasis
wechselt“. Ein Zweiprofilhaushalt allein ist kein Fehler; gemischte Flex-Basen bleiben unauswertbar.
`mcSetupDisclosure` und `mcAdvancedDisclosure` beginnen bei jeder Initialisierung geschlossen,
ohne Speicherwrite für Klappzustände. „Einstellungen anzeigen“/„Einstellungen ausblenden“
synchronisieren ARIA. Erweitert enthält RNG, Workerzahl, Zeitbudget, Vergleich und Telemetrie;
die Kurzzeile meldet nur Abweichungen von per-run-seed, 8 Prozessen, 500 ms und ausgeschalteten Diagnosen.
Ungültige Werte öffnen die nötigen Klappen und fokussieren das konkrete Feld.

Personenkarten zeigen übernommene Werte als deutsch formatierte Liste. Erst der flüchtige
Abweichungsmodus versetzt dieselben Editor-Knoten aus dem verborgenen Cache in die Karten.
IDs und Listener bleiben einmalig; Ausschalten, Reset, Profilwechsel und Reload verwerfen den Entwurf.
Die gemeinsame Rentenanpassung folgt dem Hauptprofil; fertige Ergebnisse behalten ihren Laufbeleg.

Die Ansparbedienung samt Init-, Sperr- und Speicherwirkung ist entfernt. Die vier alten Schlüssel
`sim_accumulationPhaseEnabled`, `sim_accumulationDurationYears`, `sim_accumulationSparrate`
und `sim_sparrateIndexing` bleiben bei Laden, Import und Reset unverändert erhalten.
DOM-/Profiladapter liefern Ansparen aus, Dauer/Sparrate/Übergangsjahr 0 und Übergangsalter gleich Startalter.
Explizite DOM-freie Ansparrechnungen bleiben unverändert. Merker für eine spätere Neukonzeption:
noch arbeitende Person mit Sparrate und Rentenbeginn aus Personen & Vermögen.

Browserfälle warten beim Verlaufsresize auf SVG-Ersetzung und passende reale Hostmaße;
die Pflegemessung aktiviert ausdrücklich Annahmen. Der gewollte Ergebnisstart bleibt erhalten.
Node-Prüfungen und Browserregistrierung ersetzen keine Browserabnahme. Browser-Smoke,
Personenkartenbilder bei 1366/1920/2560 und das Plattformgate sind extern offen;
die volle Node-Suite führt im orchestrierten Lauf der Orchestrator aus.


### Protokolle und Kernantworten

In der Ergebnisansicht stehen die beiden vorhandenen MC-Kernantworten neben dem Backtest oben; der MC-Detailreiter behält sie vor Kennzahlen und Grafiken. Die Antworten lauten „Ist mein Grundbedarf gedeckt?“
und „Muss ich mich einschränken?“. Die großen Werte übernehmen die bestehende Deckungsquote
und `cutYearSharePct.p50` als Prozentanteil der Jahre; der Satz ergänzt `kpiMaxKuerzung.p50`.
Der Anteil zählt abgeschlossene Entnahmejahre mit Flex-Kürzungen ab 10 %; sein Nenner
sind abgeschlossene Entnahmejahre mit endlicher Kürzungsentscheidung. Flex-Bedarf meint
frei planbare Ausgaben. Beide p50-Werte sind Mediane und können aus unterschiedlichen
Läufen stammen. Zeitraumende ist kein nachgewiesenes Lebensende. Nur ein vollständiger
simulierter Todpfad erlaubt die entsprechende Lebensendaussage. Technische Fehler sind
nicht auswertbar, fehlende Angaben bleiben „—“; Legacy-Ergebnisse tragen den fehlenden
Endzustandsbeleg ausdrücklich. Rechnung, Ergebnis-/Exportverträge und Finanzwerte bleiben gleich.
Nach wirksamer Annahmenänderung zeigen beide Antworten denselben Hinweis „Annahmen seitdem geändert“
wie das MC-Ergebnis. Reiter-/Klapp-/Detailwechsel erhalten Zahlen und Laufbeleg; erst ein
neuer vollständiger Run ersetzt Antworten und Status gemeinsam. Das verfügbare Backtest-Endjahr und fehlende Vorjahresabdeckung stehen vollständig im bestehenden Backtest-ⓘ. Entnahmen, Kürzungsjahre und Steuern sind kompakter angeordnet; Fehlgründe und Datenwarnungen bleiben erhalten.

MC- und Backtestprotokolle gliedern sich in Jahr / Alter, Personen, Entnahme und Rente,
Strategie, Marktphase, Handlung, Vermögen am Jahresende und Pflege. Die MC-Personenspalten
verwenden Profilinitialen mit vollständigem Namen in der Erklärung; der Backtest zeigt keine
Personenspalten. „Detailliert“ erweitert sichtbare Spalten; „Pflege-Spalten“ wirkt nur im MC
bei zugleich aktivierter Detailansicht. Der Backtest zeigt nie Pflege. Gold bleibt modulabhängig,
Bonds bleiben 3-Bucket-abhängig. Die vorläufige Entnahmequote erscheint nur unter Details.
58 interne Rechenspuren sowie die sechs bisherigen Personen-Einzelspalten sind ausschließlich
im vollständigen Export enthalten. Standard-/Detailansicht und Downloads lesen dieselbe
unveränderte Ergebnisquelle; kein Schalter verändert Rohwerte oder Exportvollständigkeit.

Die Node-Nachweise und registrierten Browserfälle sind getrennt von ausgeführter Browserabnahme.
Extern offen bleiben Grundbedienung Ziel 10/10, MC-Bilder bei 1920/2560 px und
„Simulator · Annahmen“ bei 1366/1920/2560 px, einschließlich Abweichungsmodus und Partnerfall.
Die Bildabnahme verlangt kein „abgeschnitten“; `mc-bilder.mjs` bleibt ein externes Werkzeug
ohne Repositoryänderung. Browser-/WebView-/Druckabnahme und das gepinnte
win32/x64/Node-v25.2.1-Charakterisierungsgate bleiben eigene Nachweise. Unter Linux wird
`tests/simulator-backtest-characterization.test.mjs` nicht separat ausgeführt; weder Baseline
noch Runnerpolicy ändern sich. Die abschließende volle `npm test`-Suite führt ausschließlich
der Orchestrator außerhalb der Sandbox auf dem fertigen Stand aus. Sandboxverbote für
Browser, Ports oder Kindprozesse sind weder Produktfehler noch ein positives Gate.

Anzeigezuordnung: `buildMonteCarloAnswers()` in `results-metrics.js` projiziert bestehende
Kennzahlen, `renderMonteCarloAnswers()` in `results-renderers.js` erzeugt `.sim-mc-answer`
im statischen Host `#monteCarloAnswers`. `displayMonteCarloResults()` bindet die Erstantworten.
`projectMonteCarloOverview()` hält die fertigen Textdeskriptoren im vorhandenen Laufbeleg;
`renderSimulatorOverviewContent()` synchronisiert daraus den Veraltetstatus. Es gibt keine
zusätzliche Rechnung, Persistenz oder Exportmetadaten.

### Fachliche Uhr im Probelauf

`simulator-person-overrides.js` und `automaticBacktestPeriod()` lesen für UI-
Kalenderdefaults die zentrale Fachuhr nach Profil-/Probelaufbereitschaft. Explizite
Referenzjahre bleiben wirksam. Die verfügbare historische Datenobergrenze bleibt
maßgeblich; ein zukünftiges Testdatum erzeugt keine zusätzlichen historischen Jahre.
Runner, Engineparameter, Rechenformeln und Baselines werden nicht umdefiniert.
Das gemeinsame Band wird nur in bestätigten zulässigen Testlaufzeiten eingeblendet.


### Probelauf mit Muster-Haushalt (Paket D, Slice 2)

Der zentrale Testmodus setzt die Fachuhr vor Profilbereitschaft. Die Profile Max und Erika sowie der
Haushaltsbedarf sind schema-validiert; Geburtsdaten 1958-03-14 / 1961-08-22 sowie
Rentenbeginn 2023-01-01 / 2027-07-01 benutzen dieselben Personenprojektionen (Erika: sechs
Monate im Startjahr 2027). Keine neue Alters-, Renten- oder Engineformel. Synthetische
Kurse betreffen UI-Wertpapierwege, nicht historische Backtest-/Monte-Carlo-Datensätze.
Alltags-Tauri bleibt gesperrt, Browserparameter und Kandidat sind die Startwege.
Der Rückkehrpunkt Vor Probelauf ist die einzige zusätzliche dauerhafte Archivausnahme;
Rohrecords kehren bytegleich zurück, der Steuerkey wird nicht exportiert/importiert.
Bei unvollständigen Phasen sind Fachwrites bis zur Recovery gesperrt. Vollständiger
Vertrag und Kurszeit-/Wochenendgrenzen: TECHNICAL.md. Node-Nachweis:
`muster-haushalt.test.mjs`; Browser-/Bild-/Kandidaten-EXE-Prüfung bleibt extern offen.


### Seitenstart und bestätigte Bereitschaft (Paket D-Folge, Slice 2)

Der gemeinsame Profilstart reserviert eine Bereitschaft je Dokument. Ein aktueller
Personenbestand durchläuft einen bestätigten Vorflush ohne unnötige Migrations-Lease;
Rahmen- und Fachstarter teilen den Abschluss. Probelaufschutz prüft erst nach
gelesenem Startzustand. Frühe Ergebnisrückfrage und schnelle Seitenwechsel sind mit
`tests/probelauf-page-start.test.mjs` belegt; Browser-/BFCache-Abnahme bleibt offen.

### Diagrammtypografie (P16b)

Monte-Carlo- und Sweep-Heatmap, Endvermögenshistogramm, Vermögensfächer,
Szenarioverläufe und Portfoliochart geben numerische SVG-Maße passend zum
Koordinatenraum aus. `chart-native-svg` verhindert in der Bildschirmkaskade
Streckung oder Schrumpfung durch die Hostbreite. Die benannten, fokussierbaren
inneren Scrollregionen kapseln schmale Ansichten; der Fächer verwendet nun
ebenfalls `ds-chart-scroll`. Druck darf die Grafiken an die Seite anpassen.

Heatmaptitel (18 px), Achsentitel (14 px) und Zahlen (13 px, tabellarische
Ziffern) haben eigene Rollen. Titel, Hinweis und Untertitel liegen im
Dokumentfluss; Spaltenwerte, Achsen und Legende erhalten eigene SVG-Bereiche.
Die drei Monte-Carlo-Fußkennzahlen sind getrennt umbrechende HTML-Paare
außerhalb des SVG. Die vorhandenen Sichtbarkeitsoptionen bleiben wirksam.
`designsystem-chart-colors.js` wählt opake helle/dunkle Textrollen gegen die
unveränderte Palette einschließlich kritischer 12-%-Überlagerung; Zelltexte
haben weder Halo noch Labelplatte. Daten, Bins, Berichtsreferenz und Rundung
bleiben unverändert. Pareto besitzt bereits native Maße ohne viewBox;
Sensitivität verwendet HTML/CSS und benötigt diese SVG-Korrektur nicht.

`Heatmap typography` und `Designsystem tools` registrieren Schriftmatrix-,
Textgrenzen-, Legenden- und Tastaturmessungen bei 1366/1920/2560/390 CSS-Pixeln.
Diese Registrierung und die Node-Prüfungen ersetzen keine externe Ausführung
oder Bildfreigabe. Die Steuerung prüft echten MC-Lauf, Sweep, Grundbedienung
und Bilder bei 1366/1920/2560 px vor der Abnahme.

### Einheitliche Szenarioauswahl (P16c, Slice 2)

`#scenarioSelector` enthält statisch Gruppenhost, `details` und genau eine Listbox.
`scenarioGroupEntries()` sortiert ausschließlich die dargestellte Stichprobe nach
nominalem Endvermögen, dann Quellindex und Kennung; fehlende Werte stehen zuletzt.
Quellarrays, doppelte Quellreferenzen und Analyzer-Auswahl bleiben erhalten.
Der Binder verwaltet Kennung, aktive Gruppe, deren letzte Auswahl und Modus.
Pfeil hoch/runter und Home/End bewegen nur den Fokus; Enter/Leertaste wählen.
Ein Roving-Tabindex und sichtbarer Fokus unterscheiden Auswahl und Fokus.
Vorheriges/Nächstes bleiben innerhalb der Gruppe und sind an Grenzen gesperrt.
Der Kopf zeigt Ausgewählt, Moduswert/Ruin, beobachtete Personenereignisse,
echtes Startjahr und Logzeilenzahl. Kontext- und Outcomehinweise bleiben im
Protokollkopf. Bis 1100 px öffnet „Szenario: Name · Wert“ dieselbe begrenzte Liste.
Real/Nominal und Resize projizieren keine neuen Exportrecords. Protokoll und
JSON/CSV bleiben vollständig nominal mit eingefrorenem Personenbeleg.
`renderSelectedScenario(id, scenario)` erhält das Quellobjekt direkt und hält
es auch für Checkboxen; die Initialbindung benötigt keine fertige Binderreferenz.
Replay-Rückweg öffnet die Klappe und fokussiert die aktuelle Option. Rebind und
neuer MC-Lauf entfernen alte Handler, Export- und Replayquellen.

### Simulator-Seitendialoge (Paket 9)

`simulator-main-reset.js` fragt über `app/shared/page-dialog.js` mit „Einstellungen zurücksetzen“/„Abbrechen“ vor Mutation und sperrt schon die Rückfrage. Der bestehende Reset-/Flush-/Reloadcontroller erhält Schlüsselumfang, Personenschutz und Retry. `simulator-sweep.js` fragt oberhalb von 5.000.000 nominellen Laufjahren mit „Sweep starten“/„Abbrechen“; Faktoren und unsichere Dauer bleiben sichtbar. Abbruch, Escape, Signal und Kontextwechsel starten keinen Job und erhalten alte Ergebnisse/Heatmap.

Pareto verwendet `page-choice-dialog.js` mit zwei Selects, exakt acht bisherigen Metriken und den Vorbelegungen `medianEndWealth`/`worst5Drawdown`; „Diagramm anzeigen“/„Abbrechen“. Ungültige Werte bleiben im Dialog. Nur Zustimmung setzt beide Metriken und rendert einmal. Reine Ranking-, Sensitivity-, Constraint- und Optimierungsfunktionen bleiben unverändert.

Sweep, Optimizer, Auto-Optimize und Visualisierung zeigen Hinweise über `showPageAlert` mit Titel, bisheriger Fachinformation, nächstem Schritt und „Verstanden“. Monte-Carlo nutzt denselben kontrollierten Fehlerhinweis, wenn der reguläre Fehlercontainer fehlt. `stress-replay-ui.js` schützt Ersetzen, Import und Verwerfen durch Busy vor Rückfrage, Kontextprüfung vor Write und einmalige Aktion. Abweichungsmodus, Vergleichsrechnung und Export-/Importformate bleiben erhalten. Navigationsschutz, MC-Ergebnispanels, Datei-/Editor-/HTML-Telemetriebedienung bleiben eigenständig. Browser-/Bild-/WebViewabnahme ist extern offen.


## Gemeinsame Planintegration H1: Grenzen und Nachweise

`simulator-engine-input.js` reicht `minCashBufferMonths` unverändert weiter; alle
übrigen Planfelder gelangen über den vorhandenen Portfoliokontext zur Engine.
CAPE entscheidet an der Enginegrenze über die wirksame Dynamik. Runner behalten
explizite flüchtige Parameter; weder Formeln noch Backtestbaselines ändern sich.
`overview-simulation-summary.js` berücksichtigt wirksame Planwerte im Fingerabdruck
und liest nach Bestätigung keine alten Simulatorplankopien mehr.

Im Versuch setzt der Sitzungsbesitzer bei verändertem `marketCapeRatio`
`cape.asOf` und `cape.source` auf `null`. Zurück zum Ausgangswert erhält die
bestätigte Herkunft. Erst die bewusste Übernahme schreibt diese Blattfelder.
Ungültige Eingaben bleiben mit sichtbarem Feldfehler ungespeichert und erhalten
den bestätigten Wert samt Herkunft. Andere Feldwrites erhalten alle CAPE-Felder.
Initialisierung und `getCommonInputs()` speichern nichts; ein geänderter
Versuchs-CAPE hat bereits in der flüchtigen Projektion keine bestätigte Herkunft; der allgemeine
verschachtelte Patchvertrag und die Zuordnung zu `capeRatio`/`marketCapeRatio`
an der Enginegrenze bleiben erhalten.

Die Umstellung bestätigt zuerst den Wiederherstellungspunkt „Vor Umstellung
Haushalt & Plan“. Konflikte und gekoppelte Mindest-Flex-Fehler verlangen eine
Auswahl; Vertagung schreibt keinen Teilplan. `annual_plan_record_v1` ist der
unveränderliche Beleg des Jahresabschlusses, kein Eröffnungs-/Migrationsprodukt.
Muster und Probelauf verwenden dieselben Verträge. H2 ergänzt den lesenden
Plan und flüchtige Versuche; H3/H4 bleiben eigenständige Abschlussschritte.

`tests/simulator-household-plan.test.mjs` prüft unabhängige Einzel-Planwertorakel,
Altquellen-Readspion, drei Mitglieder, Vermögen/Einkommen, Provenienzschutz,
Formularvorrang, Preset-/Reload-/Außenbereichsschutz und einen Siebenmonatspuffer.
Die CAPE-Probe prüft Nicht-CAPE-Erhalt, beide manuellen Ereignisse und ungültige
Eingaben am bestätigten Plan und am nach Flush zurückgelesenen Backend.
Browserquellen registrieren Bedarf-Reload/Reset, Simulator–Balance-Wechsel sowie
stille Umstellung, Konflikt, Vertagung und Probelauf. Ihre reale Browserausführung
und die Prüfung einer privaten echten Altbestandskopie erfolgen durch die Steuerung.
Der registrierte Fall „H1 Simulator shared plan crosspage“ prüft zusätzlich
CAPE-Herkunftserhalt, manuellen Reset auf ausdrückliche Nullwerte und denselben
CAPE in Balance sowie nach Rückkehr zum Simulator, jeweils mit IndexedDB-Readback.

### Flüchtiger Planversuch und Laufbasis (H2)

`app/shared/plan-trial.js` kapselt DOM-freien Zustand, Scope, Ausgangswerte,
Revision, effektive Werte, Busy-Zustand und feldgenaue Differenzen. Besitzer werden
mit `registerPlanTrial` je Dokument ausdrücklich registriert; Dynamic-Flex erkennt
sie über diese Registrierung. `simulator-plan-trial.js` bleibt der Formularadapter:
`initSimulatorPlanTrial`, `renderSimulatorPlanTrial`, `updateSimulatorPlanTrial`.
Nur `adopt()` schreibt nach Auswahl und Validierung des entstehenden Gesamtplans
mit dem bestehenden transaktionalen `patchHouseholdPlan`. `requestPageChoice`
zeigt pro Blatt aktuelle alte und neue Werte mit „Übernehmen“/„Im Plan belassen“.
Abbruch und ungültige Teilkombinationen schreiben nichts; erfolgreiche Teilübernahme
beendet den Versuch und projiziert den tatsächlich gespeicherten Plan. Unsichtbare aktuelle Felder werden nicht überschrieben. Bereich,
geöffnete Person, Formularrevision und aktuelle Planbasis werden über Dialog und
Write geprüft; Rücknahmefehler respektieren die bestehende Schreibblockade.
Der Seiten-Guard schützt Wechsel und die Übernahmeoperation. Ein echter
Mitgliedschaftswechsel fragt vor Verwerfen, dieselbe Bereichsprojektion erhält
den Entwurf. Zurück/Reset zeigen den aktuellen Plan ohne gemeinsamen Planverlust.

`updateSimulatorPlanTrial()` projiziert ein im Lesemodus abgewiesenes Update
synchron auf das Formular zurück. Aktive ungültige Entwürfe bleiben dagegen mit
ihrem Validierungsgrund erhalten und sperren `getCommonInputs()` ohne Planfallback
oder Mindest-Flex-Kappung. Dynamic-Flex-Listener erkennen nach der Rückprojektion
das Preset erneut und aktualisieren Checkboxen, fachliche Sperren und zugängliche
Planherkunft. Auch beim Rückweg wird zuerst projiziert und danach abgeleitet.
Ein zuvor bestätigter, verlorener Plan gibt weder Autosave noch alte Rechenquellen
frei; vor der ersten Bestätigung gilt weiterhin das bedienbare Altformular.

`simulator-main-input-persist.js` berücksichtigt auch für `dynamicFlexPreset` und
`dynamicFlexShowAdvanced` die dokumentlokale Live-Bestätigungsgrenze. Nach einer
späteren Bestätigung im selben Dokument fallen diese Ereignisse weder im Lesemodus
noch im aktiven Versuch auf alte `sim_*`-Writes durch. Das Planpreset wird im
Lesemodus zurückprojiziert; im Versuch wirken Presets lokal. Die Detaildarstellung
bleibt seitenlokal bedienbar. Ein späterer Planverlust öffnet diese Persistenz
nicht wieder. Vor Erstbestätigung bleiben Alt-Presetwrites möglich; unabhängige
Simulatorannahmen und Felder ohne bisherigen Autosave behalten ihren Vertrag.
`tests/simulator-household-plan.test.mjs` startet alle vier produktiven
Initialisierungen ohne Plan, veröffentlicht ihn transaktional und nutzt den
zurückgegebenen Profilrefresh ohne Neubindung. Nach Flush vergleicht die Probe
sämtliche `sim_*`-Schlüssel und Backendrohbytes sowie Plan-, Bedarfs- und Profilbestand
nach Lesemodusereignissen, aktiver Versuchsbedienung und späterem Planverlust.
Der registrierte Browserfall „Simulator Altformular nach Später und Planübernahme
ohne Reload“ bestätigt über den echten Dialog, bedient Versuchsstart, Presetknopf
und Detailcheckbox und liest die geschützten Backendrecords nach Flush zurück.
Registrierung und Syntaxprüfung ersetzen keine externe Browserabnahme.

`applyChampionToForm()` verwendet unverändert Registry und Evaluationsfingerabdrücke.
Abweichende Planwerte können im Lesemodus mit
`AUTO_OPTIMIZE_APPLY_READBACK_FINGERPRINT_MISMATCH` abgewiesen werden. Bei ausgeschaltetem
Go-Go scheitert die Faktor-/Checkboxkopplung schon mit `AUTO_OPTIMIZE_APPLY_SIDE_EFFECT_MISMATCH`.
Identische Werte dürfen bei gültigem bestätigtem Plan unverändert erfolgreich sein.
`applyChampionToConfig()` prüft innerhalb seiner Fehlerbehandlung den synchronisierten
Zustand über `getSimulatorPlanTrial().read()` vor `applyChampionToForm()`.
Bei `confirmed && !scope` verlangt der Handler die Wiederherstellung des gemeinsamen
Plans und springt vor Formularmutation, Anzeigenrefresh und Erfolgsanhang zurück.
Auch identische Champions sind bei fehlendem oder ungültigem zuvor bestätigtem Plan gesperrt.
Der Simulatorleser reicht ungültige Planrecords als Status `invalid` weiter, damit
der Zustandsbesitzer den Verlust synchronisieren kann; der Balance-Leser wirft
weiterhin den Validierungsfehler bei identischer Bereichsauswahl.
Versuchsstart und `getCommonInputs()` bleiben gesperrt;
der Hinweis stellt keinen Plan automatisch her und öffnet keine Altwritewege.
Nur `confirmed && scope && !active` zeigt unabhängig vom Fehlercode den bisherigen
vollständigen Weg über „Nur hier ausprobieren“. Vor Erstbestätigung und im aktiven Versuch
gilt die allgemeine Fehlerdarstellung, auch bei einem Fingerprintfehler. Eine Ablehnung
beendet den Handler vor Erfolgsrefresh und Erfolgsanhang.
Nach ausdrücklichem Versuchsstart erreicht derselbe Champion
Formular und Laufeingabe einschließlich Go-Go-Kopplung und Abweichungsnachweis,
ohne Plan-, `sim_*`-, Bedarfs- oder Profilwrite.

`getCommonInputs()` liest ausschließlich die bestätigte oder validierte effektive
Projektion. Ein WeakMap-Nachweis am Eingabeobjekt ist kein Engineparameter.
`readOverviewAssumptions()` kopiert ihn in den dokumentlokalen Laufkopf;
`beginSimulationSummary()` friert ihn für die Ablage ein. Abweichende Läufe
schreiben keine Startseitenzusammenfassung und erzeugen keinen Werkstattbeleg für
Planergebnisse. Rückweg/Übernahme ändern diese Entscheidung nicht. Personen- und
Werkstattabweichungen behalten ihre bestehenden Nachweise.

Nachweise: `tests/simulator-plan-trial.test.mjs` (Speicherbytes, verschachtelte
Übernahme, Dialog-/Write-/Rücknahmefehler, Reset/Scope/Reload),
`tests/simulator-overview-summary-integration.test.mjs` (echte kleine Backtest-/MC-
Erzeuger und Ablage) und `tests/simulator-result-overview.test.mjs` (Laufkopf in
beiden zeitlichen Richtungen). Browserfall „Haushalt und Plan Manager und Belegvergleich“ erweitert
den Max/Erika-Durchstich; reale Ausführung und Bildabnahme durch die Steuerung.
`tests/simulator-plan-trial.test.mjs` prüft außerdem synchrone Formular-/Laufgleichheit,
die echte Champion-Rücklesung, den produktiven UI-Handler und sämtliche synthetischen
Backendrohbytes nach `PersistenceFacade.flush()`. Der registrierte Browserfall
„Simulator Planlesemodus und Championübernahme“ bedient den echten Übernehmen-Knopf
und Seitendialog vor und nach Versuchsstart mit Go-Go an und aus. Nach Planentfernung
und Flush prüft er identische und abweichende Champions im selben Dokument gegen
unveränderte Planfelder, Checkboxen, Preset, Sperren und sortierte geschützte
IndexedDB-Rohrecords einschließlich aktueller/aktiver Profilkeys. Die Node-Probe
nutzt für fehlende und ungültige zuvor bestätigte Pläne eigene Verlustbaselines
und echte Listener/Formularanwendung: genau ein Wiederherstellungshinweis,
null Apply-, Refresh- und Erfolgsaufrufe sowie bytegleicher Cache und Backend.
Die isolierte Go-Go-aus-Node-Probe verwendet den
echten Zustandsbesitzer und sichert zusätzlich Hinweis, Erfolgsrefresh und
allgemeine Fehlerdarstellung vor Erstbestätigung und im aktiven Versuch ab.
Gezielte Befehle: `node tests/run-single.mjs tests/simulator-plan-trial.test.mjs` und
`node tests/browser-smoke.test.mjs --only="Simulator Planlesemodus und Championübernahme"`.
Seine Ablehnungsassertion wird zusätzlich am produktiven UI-Funktionskörper ohne
Browserstart ausgeführt; Registrierung und Syntaxprüfung ersetzen nicht den
externen Browser-Durchstich als Pflichtgate auf dem fertigen Quellstand.

### H5: Bestätigte Planwerte und formatierte Versuchsfelder

Die eigene Plankarte und doppelte Werteliste entfallen. In den Köpfen von
„2 Bedarf“ und „3 Reserven & Entnahme“ steuern beide Knöpfe denselben Versuch,
auch bei geschlossenem Karteninhalt. Ohne Versuch bleiben Planfelder lesend;
„Im Plan ändern“ führt zum Manager. Nur im Versuch erscheint das kompakte beige
Band mit Differenzen, Rückkehr, Auswahlübernahme und Spielbereichhinweis.
Liquiditäts-Reichweite bleibt in Karte 3 außerhalb von Band und Detailklappe.
`household-plan-fields.js` projiziert die führenden Labels und Optionsnamen und
bewahrt Hilfekinder/Infoknöpfe. Die Kartenbezeichnung stammt aus den gemeinsamen
Gruppen, Presetoptionen aus `DYNAMIC_FLEX_OPTIONS`. `rebalancingBand` ist eine
zusätzliche Anzeigespezifikation mit Profilherkunft, kein Planfeld. Der Versuch
registriert es als lokalen Wert; Rückkehr setzt es zurück, Planübernahme schreibt
es niemals. Die bisherigen Exporte des Simulatoradapters bleiben kompatibel.

Nur numerische Planfelder mit gemeinsamer Beschreibung werden mit
`household-plan-fields.js` optiert. `simulator-input-dom.js`, die Formularpatchgrenze,
Presets, Champion- und Sweepübernahmen lesen/schreiben kanonische Zahlen über den
Adapter; der restliche Simulator und Legacyformulare behalten ihre Parser.
Quantile und Anteile bearbeiten Prozentzahlen, Faktoren bleiben Faktoren.
Leere Pflichtfelder bleiben ungültig; die nullable Auffüllschwelle bleibt `null`.
Der Strategiewechsel setzt in optierten Feldern keine stillen Defaults.

Node-Nachweise: `simulator-input-readers`, `simulator-household-plan` und
`simulator-plan-trial` sowie `plan-trial` prüfen tatsächliche Leser/Schreiber, Skalierung, Präzision,
Scope-/Planverlust, Bestätigung und bytegleiche Backendrecords ohne Übernahme.
Browserfälle sind angepasst; Ausführung und Bildvergleich sind externe Gates.

## Gemeinsame Dynamic-Flex-Voreinstellungen

`app/shared/dynamic-flex-presets.js` ist die einzige Presetquelle für Balance,
Simulator, Manager und Abschlusseditor: Aus, Konservativ, Ausgewogen, Offensiv,
Benutzerdefiniert. Sie erzeugt ausschließlich bestehende Dynamikfelder; die
Langlebigkeitsdefaults stammen weiterhin aus
`app/simulator/dynamic-flex-longevity-contract.js`. Die Erkennung ist lesend:
Aus gilt unabhängig von erhaltenen Details; aktive Presets vergleichen sieben
Felder mit Toleranz `1e-9`, sonst gilt Benutzerdefiniert. Inaktive
Langlebigkeits-Unterwerte beeinflussen die Erkennung nicht.

`app/shared/household-plan-dynamic-flex.js` bindet die fünf Segmente in Manager
und Jahreseditor. Feste Presets verbergen die Details und zeigen
„Voreinstellung gilt; Details sind ausgeblendet.“. Aus → Benutzerdefiniert
setzt nur `dynamicFlex = true`, erhält vorhandene Details und validiert auch
noch offene Eingaben im selben Batch. Bei aktiver Dynamik öffnet Benutzerdefiniert
nur die Details; diese Absicht bleibt lokal bis zum Neuladen oder Verwerfen.
Die native An/Aus-Kontrolle ist dort verborgen, Ausschalten erfolgt über Aus.
Sperren, fachliche Feldabhängigkeiten, Retry und Rücknahme bleiben erhalten.

Der Manager bestätigt den gesamten Batch über seinen entprellten Autosave.
Der Simulator liest den bestätigten Plan; Presetänderungen im Versuch bleiben
flüchtig bis zur ausdrücklichen Übernahme. Der Jahresabschluss ändert nur den
Entwurf über `createAnnualPlanDraft.changeBatch`: eine Revision und eine aktuelle
Berechnung, ältere Resultate werden entwertet. Abbruch/Verwerfen speichert nichts;
ausschließlich die vorhandene Abschlussbestätigung übernimmt den
`adoptedPlanPatch`. Es gibt keine neue Presetkennung im Plandatensatz und keinen
neuen Persistenzkey; CAPE-Provenienz und übrige Planfelder bleiben erhalten.

Node-Belege: `tests/dynamic-flex-presets.test.mjs`,
`tests/household-plan-fields.test.mjs`, `tests/tranchen-manager-page.test.mjs`,
`tests/annual-plan-editor.test.mjs`, `tests/simulator-dynamic-flex-persistence.test.mjs`
und `tests/balance-dynamic-flex-gate.test.mjs`. Browserfälle:
„Dynamic Flex Voreinstellungen seitenübergreifend“ und
„Dynamic Flex Voreinstellungen im Abschlussentwurf“.

## Gemeinsamer Versuch in Balance und Simulator (AU1d, Slice 3)

Beide Seiten verwenden den dokumentlokal registrierten Besitzer aus
`app/shared/plan-trial.js`. `balance-plan-trial.js` und `simulator-plan-trial.js`
projizieren ihre Feld-IDs und Kartenköpfe auf dieselbe Planquelle. Rückkehr/Reload
verwerfen den Entwurf; Auswahlübernahme validiert den gesamten resultierenden Plan
und schreibt nur gewählte Planfelder. Gold-Umschichtungsband bleibt eine lokale
Profilabweichung mit dauerhaftem Ursprung unter Personen & Vermögen.
Dynamic-Flex verwendet den registrierten Seitenadapter; Refresh und Presetwahl
heben die Lesesperre nicht auf und speichern keinen Versuch.

Balance erzwingt für einen Versuch den Vorschaupfad und überspringt Summarywrites
sowie die Veröffentlichung von Profil-Ergebnisaggregaten. Die Startseite und der
Jahresbeleg bleiben beim Plan; der Abschluss beginnt mit bestätigten Planwerten.
Die gemeinsame Inflationsquelle `balance-inflation-source.js` liest Jahreswert,
Bereich und `periodId` aus dem passenden Beleg oder benennt einen gespeicherten
Altstand ohne erfundene Herkunft. Manuelle Ersatzrate und jährliche Fortschreibung
bleiben im Abschlussweg. Parametrische Adapter- und Speicherprüfungen stehen in
`tests/balance-plan-trial.test.mjs`.
