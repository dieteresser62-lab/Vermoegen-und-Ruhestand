import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { normalizeTrancheCollection } from '../types/tranche-contract.js';
import { dynamicFlexPresetPatch } from '../app/shared/dynamic-flex-presets.js';
import { buildSimulatorInputsFromProfileData, combineSimulatorProfiles } from '../app/simulator/simulator-profile-inputs.js';
import { validateSimulatorInputs } from '../app/simulator/simulator-input-validation.js';
import { initializePortfolio } from '../app/simulator/simulator-portfolio.js';
import { simulateOneYear } from '../app/simulator/simulator-engine-direct.js';
import { computeAdjPctForYear } from '../app/simulator/simulator-main-helpers.js';
import { resolveDynamicFlexRunnerHorizon } from '../app/simulator/dynamic-flex-runner-horizon.js';
import { createHistoricalBacktestContractProvider } from '../app/simulator/historical-backtest-contract.js';
import { runHistoricalBacktest } from '../app/simulator/historical-backtest-runner.js';
import { portfolioTotal } from '../app/simulator/simulator-results.js';
import { prepareHistoricalDataOnce } from '../app/simulator/simulator-engine-helpers.js';
import { deriveMinimumFlexPath } from '../app/simulator/minimum-flex-metrics.js';
import { analyzeBacktest } from '../app/simulator/log-analysis-events.js';
import { buildBacktestAnalysisView } from '../app/simulator/backtest-log-analysis.js';
import { buildBacktestChartAnnotations } from '../app/simulator/backtest-chart-annotations.js';
import { EngineAPI } from '../engine/index.mjs';

// D24-Musterfall nach FR-8 bis FR-16, ohne externe JSON-Belege oder private Profile.
// GS-3b: FR-11 erklärt die zusätzliche Kürzungsdauer; FR-10 die persönlichen
// Deckungsverkäufe und Steuern. Die Zuordnung steht in auftrag/ERGEBNIS-GS-3b.md.
// GS-5b: Partnerdeckung der Steuer 2021 nach FR-16 verändert die spätere
// Auszahlungsreihenfolge; Belege für den entfallenen Verkauf 2025 stehen in
// auftrag/ERGEBNIS-GS-5b.md.
const records = createMusterHaushaltRecords('2026-10-15');
const registry = JSON.parse(records.rs_profiles_v1);
const plan = { ...Object.values(JSON.parse(records.household_plan_v1).entries)[0].values, ...dynamicFlexPresetPatch('ausgewogen') };
const profiles = Object.entries(registry.profiles).map(([profileId, profile]) => {
    // GU-1 (FR-74): Der belegte Musterfall bleibt bei der damaligen Beispielwahl „wie Löhne“; die neue Vorgabe prüft gu-1-sollfaelle.
    const data = { ...profile.data, profile_rentenanpassung_art: 'wage', depot_tranchen: JSON.stringify(normalizeTrancheCollection(JSON.parse(profile.data.depot_tranchen), { mode: 'persisted' })) };
    return { profileId, name: profile.meta.name, inputs: buildSimulatorInputsFromProfileData(data, { referenceYear: 2026, planValues: plan }) };
});
const merged = combineSimulatorProfiles(profiles, 'muster_a', { planValues: plan });
assert(!!merged.combined, 'Muster-Haushalt mit beiden Personen projizieren');
const inputs = validateSimulatorInputs(merged.combined);
assertEqual(inputs.startVermoegen, 790000, 'Muster-Startvermögen');
assertEqual(inputs.minimumFlexAnnual, 7500, 'Muster-Mindest-Flex');
prepareHistoricalDataOnce();
const result = runHistoricalBacktest({ inputs, period: { startYear: 2000, endYear: 2025 },
    historicalDataProvider: createHistoricalBacktestContractProvider(), initializePortfolio,
    simulateYear: (...args) => simulateOneYear(...args, null, 0, null, 1, EngineAPI),
    computeAdjustmentPct: computeAdjPctForYear, resolveHorizon: resolveDynamicFlexRunnerHorizon,
    totalPortfolio: portfolioTotal, breakOnRuin: true });
assertEqual(result.outcome.kind, 'completed', 'Echter Engine-Backtest 2000–2025 erfolgreich');
const before = JSON.stringify(result);
const model = analyzeBacktest(result);
assertEqual(JSON.stringify(result), before, 'Analyse lässt das echte Backtestergebnis unverändert');
assertEqual(model.financialYears, 26, '26 abgeschlossene Finanzjahre');
assertEqual(model.minimumFlex.affectedYearCount, deriveMinimumFlexPath(result.rows).affectedYearCount, 'FR-6-Parität des echten Backtests');
assertEqual(model.minimumFlex.affectedYearCount, 0, 'Muster-Haushalt bleibt über Mindest-Flex');
assertEqual(model.cuts.observedYears, 1, 'FR-60: ein Kürzungsjahr nach stetiger Kaufkraft-Anhebung');
assertEqual(model.cuts.longestYears, 1, 'FR-60: ein Jahr mit Flex-Kürzung');
const cuts = model.events.filter(event => event.type === 'decision_flex_cut_phase');
assertEqual(cuts.map(event => `${event.evidence.startYear}-${event.evidence.endYear}`).join(), '2009-2009', 'FR-46: belegte Kürzungsphase 2009–2009');
assertEqual(cuts.length, 1, 'Nur die belegte Kürzungsphase erzeugen');
const low = model.events.find(event => event.type === 'minimum_real_year_end_wealth');
assertEqual(low.year, 2008, 'Reales Jahrestief 2008');
assertClose(low.evidence.amountRealEur, 385000, 1000, 'FR-46: reales Tief rund 385.000 Euro, ohne plattformgebundene Bytes');
assertClose(model.realEndWealth, result.metrics.values.wealth_end_real_eur, 1e-6, 'Jahresend-Realbasis stimmt mit kanonischen Backtestmetriken überein');
// LE-1 (FR-75): Dynamic-Flex-Horizont aus der Kohortentafel (länger) senkt die Entnahme; Endstand vorher rund 760.000 Euro.
assertClose(model.realEndWealth, 768000, 1000, 'QS-C: Endstand mit Teilfreistellung der eigenen Aktiennachkäufe');
assertEqual(model.events.filter(event => event.type === 'liquidity_below_target').length, 11, 'FR-46: elf Unterschreitungen des bedarfsbezogenen Liquiditätsziels');
assert(result.rows.every(({ row }) => row.RunwayMeasurementPhase === 'after_transaction_before_payout'
    && Number.isFinite(row.RunwayCoveragePct) && row.RunwayCoveragePct > 0), 'Alle 26 Liquiditätsmessungen bleiben belegt');
const coverage = model.events.filter(event => event.type === 'forced_liquidity_coverage');
assertEqual(coverage.length, 0, 'FR-32: keine zusätzlichen Liquiditätsdeckungen');
assertEqual(coverage.map(event => event.year).join(), '', 'FR-32: keine zusätzlichen persönlichen Deckungsjahre');
const tax = model.prioritizedEvents.find(event => event.type === 'tax_peak');
// LE-1 (FR-75): Mit dem längeren Dynamic-Flex-Horizont verschiebt sich die stärkste Steuerspitze von 2024 (21.400 €) nach 2025.
assertEqual(tax.year, 2025, 'FR-46: stärkste Steuerspitze 2025 zuerst');
assertClose(tax.evidence.amount.nominalEur, 24400, 100, 'B9: Steuerspitze nach geänderter persönlicher Auszahlungsverteilung');
assertEqual(model.events.find(event => event.type === 'real_wealth_recovery').year, 2021, 'FR-46: reales Wiedererreichen des Startvermögens 2021');
assert(model.summarySentences.length >= 3 && model.summarySentences.length <= 6, 'Feste Gesamtzusammenfassung mit drei bis sechs Sätzen');
assert(model.summary.includes('26') && model.summary.includes('Mindest-Flex'), 'Zusammenfassung erklärt Grundbedarf und Mindest-Flex');
const view = buildBacktestAnalysisView(result);
assertEqual(view.cards.map(point => point.type).join(), 'minimum_flex_held,decision_flex_cut_phase,minimum_real_year_end_wealth', 'Musterlauf zeigt die drei Karten des abgenommenen Entwurfs');
assertEqual(view.cards[1].valueText, '1 Jahr · 2009', 'Musterkarte nennt die belegte Kürzung');
assertEqual(view.cards[2].year, 2008, 'Musterkarte verlinkt das reale Tiefjahr');
assert(view.more.some(point => point.type === 'liquidity_below_target'), 'FF-B: Weitere zeigt belegte Zielunterschreitungen');
assert(!view.more.some(point => point.type === 'forced_liquidity_coverage'), 'FR-32: keine unbelegten zusätzlichen Liquiditätsdeckungen anzeigen');
assertEqual(view.more.find(point => point.type === 'tax_peak').year, 2025, 'Weitere Punkte verlinken stärkstes Steuerjahr');
const chart = buildBacktestChartAnnotations(result);
assertEqual(chart.bands.map(band => band.label).join('|'), 'Flex gekürzt 2009–2009', 'Chartband zeigt nur die belegte Kürzungsphase');
assert(chart.markers.length <= 5 && chart.markers.some(marker => marker.type === 'minimum_real_year_end_wealth' && marker.year === 2008), 'Chart enthält das reale Muster-Tief 2008 unter höchstens fünf Marken');
assert(chart.markers.some(marker => marker.type === 'liquidity_below_target' && marker.year === 2003), 'FR-46: Chart zeigt die erste belegte Unterschreitung des Liquiditätsziels');
assertEqual(JSON.stringify(result), before, 'Auch die Chartauswahl erhält den echten Laufbeleg');
console.log(model.summary);
