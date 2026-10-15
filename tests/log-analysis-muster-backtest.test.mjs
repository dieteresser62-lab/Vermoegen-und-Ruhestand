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
    const data = { ...profile.data, depot_tranchen: JSON.stringify(normalizeTrancheCollection(JSON.parse(profile.data.depot_tranchen), { mode: 'persisted' })) };
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
assertEqual(model.cuts.observedYears, 26, '26 Jahre gekürzte Flex-Entnahme');
assertEqual(model.cuts.longestYears, 26, 'Längste Kürzungsphase umfasst 26 Jahre');
const cuts = model.events.filter(event => event.type === 'decision_flex_cut_phase');
assertEqual(cuts.map(event => `${event.evidence.startYear}-${event.evidence.endYear}`).join(), '2000-2025', 'Durchgehende Kürzungsphase nach FR-11');
assertEqual(cuts[0].evidence.openAtEnd, true, 'Kürzungsphase bleibt am Laufende offen');
const low = model.events.find(event => event.type === 'minimum_real_year_end_wealth');
assertEqual(low.year, 2008, 'Reales Jahrestief 2008');
assertClose(low.evidence.amountRealEur, 397000, 1000, 'Reales Tief rund 397.000 Euro, ohne plattformgebundene Bytes');
assertClose(model.realEndWealth, result.metrics.values.wealth_end_real_eur, 1e-6, 'Jahresend-Realbasis stimmt mit kanonischen Backtestmetriken überein');
assertClose(model.realEndWealth, 829000, 1000, 'Realer Endstand nach FR-11 und persönlichen Transaktionen nach FR-10 und FR-16');
assertEqual(model.events.filter(event => event.type === 'liquidity_below_target').length, 0, 'Keine Liquiditätsziel-Unterschreitung');
assert(result.rows.every(({ row }) => row.RunwayMeasurementPhase === 'after_transaction_before_payout'
    && Number.isFinite(row.RunwayCoveragePct) && row.RunwayCoveragePct >= 100), 'Alle 26 Liquiditätsmessungen sind belegt und mindestens am Ziel');
const coverage = model.events.filter(event => event.type === 'forced_liquidity_coverage');
assertEqual(coverage.length, 4, 'Vier zusätzliche Deckungsverkäufe für persönliche Auszahlungen nach FR-10 und FR-16');
assertEqual(coverage.map(event => event.year).join(), '2004,2008,2021,2023', 'Persönliche Deckungsverkäufe in den belegten Jahren nach FR-10 und FR-16');
const tax = model.prioritizedEvents.find(event => event.type === 'tax_peak');
assertEqual(tax.year, 2024, 'Stärkste Steuerspitze 2024 zuerst');
assertClose(tax.evidence.amount.nominalEur, 20300, 100, 'Steuerspitze rund 20.300 Euro');
assertEqual(model.events.find(event => event.type === 'real_wealth_recovery' && event.evidence.peakYear === 'start')?.year, 2015, 'Reales Anfangsvermögen 2015 wieder erreicht');
assertEqual(model.events.find(event => event.type === 'real_wealth_unrecovered')?.evidence.peakYear, 2021, 'Reales Hoch von 2021 am Laufende noch nicht wieder erreicht');
assert(model.summarySentences.length >= 3 && model.summarySentences.length <= 6, 'Feste Gesamtzusammenfassung mit drei bis sechs Sätzen');
assert(model.summary.includes('26') && model.summary.includes('Mindest-Flex'), 'Zusammenfassung erklärt Grundbedarf und Mindest-Flex');
const view = buildBacktestAnalysisView(result);
assertEqual(view.cards.map(point => point.type).join(), 'minimum_flex_held,decision_flex_cut_phase,minimum_real_year_end_wealth', 'Musterlauf zeigt die drei Karten des abgenommenen Entwurfs');
assertEqual(view.cards[1].valueText, '26 Jahre · 2000–2025', 'Musterkarte nennt längste Kürzung');
assertEqual(view.cards[2].year, 2008, 'Musterkarte verlinkt das reale Tiefjahr');
assert(!view.more.some(point => point.type === 'liquidity_below_target'), 'Weitere Punkte zeigen keine Liquiditätsziel-Unterschreitung');
assert(view.more.find(point => point.type === 'forced_liquidity_coverage').valueText.endsWith('4 Treffer'), 'Weitere Punkte bündeln vier persönliche Deckungsverkäufe nach FR-10 und FR-16');
assertEqual(view.more.find(point => point.type === 'tax_peak').year, 2024, 'Weitere Punkte verlinken stärkstes Steuerjahr');
const chart = buildBacktestChartAnnotations(result);
assertEqual(chart.bands.map(band => band.label).join('|'), 'Flex gekürzt 2000–2025', 'Chartbänder entsprechen den belegten Musterphasen');
assert(chart.markers.length <= 5 && chart.markers.some(marker => marker.type === 'minimum_real_year_end_wealth' && marker.year === 2008), 'Chart enthält das reale Muster-Tief 2008 unter höchstens fünf Marken');
assert(chart.markers.some(marker => marker.type === 'tax_peak' && marker.year === 2024), 'Chart enthält das stärkste Muster-Steuerjahr 2024');
assertEqual(JSON.stringify(result), before, 'Auch die Chartauswahl erhält den echten Laufbeleg');
console.log(model.summary);
