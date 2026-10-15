import { analyzeBacktest, analyzeScenario, analyzeMonteCarloScenario, LOG_ANALYSIS_RULE_VERSION } from '../app/simulator/log-analysis-events.js';
import { adaptBacktestResult, adaptScenarioLog } from '../app/simulator/log-analysis-adapters.js';
import { deriveMinimumFlexPath } from '../app/simulator/minimum-flex-metrics.js';

const base = (jahr, patch = {}) => ({ jahr, recordType: 'financial_year', financiallyEvaluable: true,
    entscheidung: { kuerzungProzent: 0 }, minimumFlexAnnual: 100, flex_wunsch_haushalt_nominal: 200,
    flex_haushalt_erfuellt: 100, flex_haushalt_basis: 'static_input', flex_haushalt_kuerzung_pct: 0,
    inflation: 0, inflation_factor_cum: 1, portfolio_total_end: 1000, steuern_gesamt: 0,
    executedSaleEq: 0, gold_after_return: 0, gold_after_sales: 0, kaufGld: 0, bondSaleAmount: 0, bondRefillGross: 0,
    SafetyCapActive: false, SafetyCapApplied: false, SevereFlexEmergencyActive: false, Alarm: false,
    safety_stage_current: 0, Regime: 'NORMAL', MarketExtremeBear: false,
    RunwayMeasurementPhase: 'after_transaction_before_payout', RunwayCoveragePct: 100,
    runway_after_transaction_before_payout_months: 24, health_bucket_used: 0,
    balance_trace: [{ phase: 'after_forced_sales', forcedShortfall: 0, liquiditaetDelta: 0 }],
    threeBucket: { unmetLiquidity: 0 },
    Person1Alive: 1, Person2Alive: 1, CareP1_Active: 0, CareP2_Active: 0,
    tailRiskApplied: false, tailRiskActive: false, ...patch });
const scenario = rows => ({ key: 'p50', failed: false, logDataRows: rows, endVermoegen: 1000,
    sourceIdentity: { absoluteRunIndex: 12, displayRunNumber: 13, selectionMetric: 'nominal_terminal_wealth_eur' } });
const analyze = (rows, options = {}) => analyzeScenario(scenario(rows), { initialWealth: 1000, ...options });
const byType = (model, type) => model.events.filter(event => event.type === type);
const one = (model, type) => byType(model, type)[0];
const cut = pct => ({ entscheidung: { kuerzungProzent: pct } });
function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}

// Prüffälle des D24-Spikes: FR-6-Grenzen, Lücken, Terminalzeilen, Realbasis und Lebensereignisse.
for (const [minimum, paid, expected] of [[100, 100, 0], [0, 0, 0], [100, 99.999, 1], [100, 101, 0]]) {
    const result = analyze([base(1, { minimumFlexAnnual: minimum, flex_haushalt_erfuellt: paid })]);
    assertEqual(result.minimumFlex.affectedYearCount, expected, 'Strikter FR-6-Vergleich; Gleichheit und Minimum null sind keine Unterschreitung');
}
for (const value of [null, undefined, NaN, Infinity, -1, '100']) {
    const result = analyze([base(1, { flex_haushalt_erfuellt: value })]);
    assertEqual(result.minimumFlex.affectedYearCount, null, 'Fehlende/ungültige Geldwerte bleiben unbekannt');
    assertEqual(result.missingness.minimumFlex.length, 1, 'Mindest-Flex-Missingness nennt die Zeile');
    assert(!one(result, 'minimum_flex_held'), 'Kein positives Mindest-Flex-Ereignis bei Missingness');
}
{
    const rows = [base(1, { flex_haushalt_erfuellt: 90 }), base(2, { minimumFlexAnnual: 110, flex_haushalt_erfuellt: 80 }), base(3)];
    const result = analyze(rows), phase = one(result, 'below_minimum_flex_phase');
    assertEqual(result.minimumFlex.affectedYearCount, deriveMinimumFlexPath(rows).affectedYearCount, 'Gemeinsamer FR-6-Pfadvertrag');
    assertEqual(phase.evidence.durationYears, 2, 'Zusammenhängende Mindest-Flex-Jahre bündeln');
    assertEqual(phase.evidence.maximumShortfallNominalEur, 30, 'Jährlich angewandtes Minimum verwenden');
    assertEqual(phase.evidence.observations[1].minimumNominalEur, 110, 'Keine eigene Fortschreibung des Minimums');
}
{
    const result = analyze([base(1, cut(10)), base(2, cut(30)), base(3, cut(9.999)), base(4, cut(20))]);
    const phases = byType(result, 'decision_flex_cut_phase');
    assertEqual(phases.length, 2, '10 % eingeschlossen, unter 10 % endet die Phase');
    assertEqual(phases[0].evidence.maximumAnnualValue, 30, 'Größte jährliche Kürzung');
    assertEqual(phases[0].evidence.nextYear, 3, 'Erstes Jahr unter 10 %');
    assertEqual(phases[0].evidence.durationYears, 2, 'Dauer aus Beobachtungen');
    assertEqual(phases[1].evidence.openAtEnd, true, 'Offene Endphase');
    assertEqual(result.cuts.longestYears, 2, 'Längste Kürzungsphase');
    for (const rows of [[base(1, cut(20)), base(3, cut(20))],
        [base(1, cut(20)), base(2, { entscheidung: null }), base(3, cut(20))],
        [base(1, cut(20)), null, base(2, cut(20))]]) {
        assertEqual(byType(analyze(rows), 'decision_flex_cut_phase').length, 2, 'Datenlücken trennen Phasen');
    }
    const mixed = analyze([base(1, { ...cut(20), flex_haushalt_kuerzung_pct: 30 }),
        base(2, { ...cut(20), flex_haushalt_kuerzung_pct: 60, flex_haushalt_basis: 'effective_vpw_plus_pension_surplus' })]);
    assertEqual(byType(mixed, 'household_flex_cut_phase').length, 2, 'Kein Haushaltskürzungswert über gemischte Basen');
    assertEqual(byType(mixed, 'decision_flex_cut_phase').length, 1, 'Entnahmekürzung bleibt eigenständig');
    assertEqual(one(mixed, 'flex_basis_change').year, 2, 'Basiswechsel markieren');
}
for (const recordType of ['terminal_ruin', 'terminal_death', 'technical_error']) {
    const result = analyze([base(1), base(2, { recordType, financiallyEvaluable: false,
        ...cut(100), portfolio_total_end: 0, flex_haushalt_erfuellt: 0, steuern_gesamt: 9000, executedSaleEq: 1000 })]);
    assertEqual(result.financialYears, 1, 'Terminalzeilen zählen nicht als Entnahmejahr');
    assertEqual(result.minimumFlex.affectedYearCount, 0, 'Künstliche Terminalnullen unterschreiten keinen Mindest-Flex');
    assertEqual(one(result, 'minimum_real_year_end_wealth').evidence.amountRealEur, 1000, 'Keine falschen Tiefpunkte durch Terminalnullen');
    assert(!one(result, 'large_sale') && !one(result, 'tax_peak') && !one(result, 'decision_flex_cut_phase'), 'Keine Terminal-Finanzereignisse');
    if (recordType === 'terminal_ruin') assertEqual(one(result, 'ruin').evidence.causeAvailable, false, 'MC-Ruinursache unbekannt');
    if (recordType === 'technical_error') assert(!result.floorCovered, 'Technischer Fehler ist kein erfolgreicher Pfad');
}
{
    const row = base(2000, { recordType: undefined, inflation_factor_cum: 1.2, inflation: undefined });
    const input = { portfolioStart: 1000, portfolioEnd: 1000, outcome: { kind: 'completed' }, rows: [{ jahr: 2000, inflationVJ: 10, row }] };
    const result = analyzeBacktest(input);
    assertClose(result.realEndWealth, 1000 / 1.32, 1e-9, 'Backtest deflationiert mit Jahresanfangsfaktor mal laufender Inflation');
    assertEqual(adaptBacktestResult(input).rows[0].year, 2000, 'Backtestkalender bleibt Kalenderjahr');
    assertEqual(adaptScenarioLog(scenario([base(1, { histJahr: 1974 })])).rows[0].historicalYear, 1974, 'Gezogenes Marktjahr ist keine MC-Zeitachse');
    const recovered = analyze([base(1, { portfolio_total_end: 800 }), base(2, { portfolio_total_end: 900 }), base(3)]);
    assertEqual(one(recovered, 'real_wealth_recovery').year, 3, 'Erholung erst beim früheren realen Hoch');
    assert(!one(recovered, 'real_wealth_unrecovered'), 'Erholte Phase nicht weiter offen');
    const higherPeak = analyze([base(1, { portfolio_total_end: 1200 }), base(2), base(3, { portfolio_total_end: 1100 }), base(4, { portfolio_total_end: 1200 })]);
    assertEqual(one(higherPeak, 'real_wealth_recovery').year, 4, 'Neues Hoch wird zum Erholungsziel');
    assertEqual(one(analyze([base(1, { portfolio_total_end: 800 })]), 'real_wealth_unrecovered').evidence.openAtEnd, true, 'Nicht erholte Endphase markieren');
    const gap = analyze([base(1, { portfolio_total_end: 800 }), base(3)]);
    assert(!one(gap, 'real_wealth_recovery'), 'Keine Erholung über Datenlücke behaupten');
    const missingEnd = analyze([base(1), base(2, { inflation: null })]);
    assertEqual(missingEnd.realEndWealth, null, 'Ein fehlender Endstand wird nicht durch den letzten bekannten Stand ersetzt');
    assertEqual(one(missingEnd, 'minimum_real_year_end_wealth').evidence.missingFinancialYears, 1, 'Tiefpunkt nennt unvollständige reale Beobachtungen');
    const missingInflation = analyze([base(1, { inflation: null }), base(2)]);
    assertEqual(missingInflation.realEndWealth, null, 'Unvollständige Inflation bleibt wie im Szenariodiagramm unbekannt');
    assert(!one(missingInflation, 'minimum_real_year_end_wealth'), 'Kein reales Tief aus fehlender Inflation');
}
{
    const rows = [base(1), base(2, { CareP2_Active: 1, CareP2_Grade: 3, CareP2_Cost: 12000,
        balance_trace: [{ phase: 'after_forced_sales', forcedShortfall: 500, liquiditaetDelta: 300 }],
        health_bucket_used: 100, threeBucket: { unmetLiquidity: 200 }, bondRefillGross: 2000, portfolio_total_end: 800 }),
    base(3, { Person1Alive: 0, CareP2_Active: 1, CareP2_Grade: 4, portfolio_total_end: 1000 }),
    base(4, { recordType: 'terminal_death', financiallyEvaluable: false, Person1Alive: 0, Person2Alive: 0 })];
    const input = freeze(scenario(rows)), before = JSON.stringify(input);
    const result = analyzeScenario(input, { initialWealth: 1000, hasPartner: true,
        personDisplayContext: freeze({ persons: [{ name: 'Max Mustermann' }, { name: 'Erika Mustermann' }] }) });
    for (const type of ['care_phase', 'care_grade_change', 'person_death', 'household_end',
        'forced_liquidity_need', 'forced_liquidity_coverage', 'health_reserve_use', 'unmet_liquidity', 'bond_refill', 'real_wealth_recovery'])
        assert(!!one(result, type), `Synthetischer Beleg für ${type}`);
    assertEqual(byType(result, 'person_death').length, 2, 'Tod je Person, auch auf Terminalzeile');
    assertEqual(one(result, 'care_phase').evidence.onsetObserved, true, 'Belegter Pflegebeginn');
    assertEqual(one(result, 'care_phase').evidence.durationYears, 2, 'Beobachtete Pflegedauer');
    assert(one(result, 'care_phase').text.includes('Erika Mustermann'), 'Namen aus übergebenem Laufkontext');
    assertEqual(one(result, 'forced_liquidity_coverage').evidence.amount.nominalEur, 300, 'Ausgeführte Notfüllung getrennt vom Bedarf');
    assertEqual(one(result, 'forced_liquidity_need').evidence.amount.nominalEur, 500, 'Trace-Bedarf ist vor Notverkäufen');
    assertEqual(JSON.stringify(input), before, 'Analyse mutiert auch tief eingefrorene Jahresdaten nicht');
    const gaps = analyze([base(1), base(3, { Person1Alive: 0, CareP1_Active: 1, CareP1_Grade: 2 })]);
    assert(!one(gaps, 'person_death'), 'Lebensstatuslücke belegt kein Todesjahr');
    assertEqual(one(gaps, 'care_phase').evidence.onsetObserved, false, 'Pflegezustand nach Lücke ist kein belegter Beginn');
    assertEqual(one(gaps, 'life_state_observation').evidence.deathYearKnown, false, 'Unbekanntes Todesjahr ausdrücklich ausweisen');
    const noSales = analyze([base(1, { vk: { vkAkt: 1000, vkGld: 500 }, balance_trace: null })]);
    assert(!one(noSales, 'forced_liquidity_coverage'), 'Reguläres vk belegt keine Notverkäufe');
    assertEqual(noSales.missingness.forcedSales.length, 1, 'Altlogs ohne Trace bleiben unbekannt');
    const regularGold = analyze([base(1, { gold_after_return: null, gold_after_sales: null, vk: { vkGld: 100 } })]);
    assertEqual(one(regularGold, 'gold_sale').evidence.amount.nominalEur, 100, 'Regulärer Goldverkauf bleibt ohne Gesamtsnapshot sichtbar');
    assertEqual(one(regularGold, 'gold_sale').evidence.scope, 'regular_only', 'Regulärer Verkauf wird nicht zum Gesamtverkauf umgedeutet');
    assert(!one(analyze([base(1, { balance_trace: [{ phase: 'after_forced_sales', forcedShortfall: 500, liquiditaetDelta: 0 }] })]), 'forced_liquidity_coverage'), 'Bedarf ohne Nettoerlös behauptet keinen Verkauf');
}
{
    const result = analyze([base(1, { SafetyCapActive: true }), base(2, { SafetyCapActive: true,
        SafetyCapApplied: true, SevereFlexEmergencyActive: true, Alarm: true, safety_stage_current: 2,
        CutReason: 'alarm', FinalLimitingPolicy: 'safety_cap', safety_transition: 'up' }), base(3)]);
    assert(one(result, 'initial_policy_observation').text.includes('Bereitschaft'), 'SafetyCapActive bedeutet Bereitschaft');
    assertEqual(byType(result, 'policy_state_change').filter(event => event.evidence.field === 'SafetyCapApplied').length, 2, 'Tatsächlicher Eingriff hat Ein- und Austritt');
    assertEqual(byType(result, 'policy_state_change').find(event => event.evidence.field === 'Alarm').evidence.cutReason, 'alarm', 'Nur protokollierte Policy-Belege');
    const markets = analyze([base(1), base(2, { Regime: 'BEAR', MarketExtremeBear: true }), base(4, { Regime: 'BULL' })]);
    assertEqual(byType(markets, 'market_regime_change').length, 1, 'Keine Markttransition über Lücke');
    assertEqual(one(markets, 'extreme_bear').year, 2, 'Extrembär gesondert');
    const liquidity = analyze([base(1, { RunwayCoveragePct: 99 }), base(2, { RunwayCoveragePct: 20, RunwayMeasurementPhase: 'post_payout_end_of_year' })]);
    assertEqual(byType(liquidity, 'liquidity_below_target').length, 1, 'Nur nach Transaktionen und vor Auszahlung messen');
    assertEqual(one(liquidity, 'liquidity_below_target').evidence.targetGapPct, 1, 'Abstand zum Ziel');
}
{
    const result = analyze([base(1, { executedSaleEq: 99.999, steuern_gesamt: 500 }),
        base(2, { executedSaleEq: 80, gold_after_return: 50, gold_after_sales: 40, bondSaleAmount: 10,
            kaufGld: 20, bondRefillGross: 30, steuern_gesamt: 500 }), base(3, { steuern_gesamt: 1000 }), base(4, { steuern_gesamt: 2000 })]);
    assertEqual(byType(result, 'large_sale').length, 1, 'Verkauf ab 10 % inklusive Gold und Anleihen');
    assertEqual(one(result, 'large_sale').year, 2, 'Verkauf knapp unter Schwelle bleibt aus');
    assertEqual(byType(result, 'tax_peak').length, 1, 'Steuer mindestens zweifacher Median und strikt über 1.000 Euro');
    assertEqual(one(result, 'tax_peak').evidence.medianTaxNominalEur, 750, 'Nominaler Laufmedian');
    assertEqual(one(result, 'tax_peak').confidence, 'heuristic', 'Steuerspitze ist ein Anzeigefilter');
    for (const type of ['gold_purchase', 'gold_sale', 'bond_refill', 'bond_sale']) assert(!!one(result, type), 'Kauf und Verkauf nicht saldieren');
    assert(!!one(analyze([base(1), base(2), base(3, { steuern_gesamt: 1001 })]), 'tax_peak'), 'Median null schließt positive Spitze nicht aus');
    const incomplete = analyze([base(1, { steuern_gesamt: null }), base(2, { steuern_gesamt: 9000 })]);
    assert(!one(incomplete, 'tax_peak'), 'Fehlende Steuerwerte erlauben keinen vollständigen Laufmedian');
    const gap = analyze([base(1), base(3, { executedSaleEq: 200 })]);
    assert(!one(gap, 'large_sale'), 'Verkauf nicht durch Vermögen vor einer Datenlücke teilen');
}
{
    const mc = analyzeScenario({ ...scenario([base(1), base(2, { recordType: 'terminal_ruin', financiallyEvaluable: false, GuardNote: 'Pflege' })]), failed: true });
    assertEqual(one(mc, 'ruin').evidence.reason, null, 'MC-Endzeile belegt keinen konkreten Adaptergrund');
    const bt = analyzeBacktest({ portfolioStart: 1000, outcome: { kind: 'ruin', ruinYear: 2001, reason: 'Floor-Lücke' },
        rows: [{ jahr: 2000, inflationVJ: 0, row: base(2000) }, { jahr: 2001, row: base(2001, {
            recordType: 'terminal_ruin', financiallyEvaluable: false, floor_shortfall_nominal: 150,
            floor_coverage_required_nominal: 500, floor_coverage_covered_nominal: 350 }) }] });
    assertEqual(one(bt, 'ruin').evidence.reason, 'Floor-Lücke', 'Backtest hat dokumentierten Grund');
    assertEqual(one(bt, 'floor_shortfall').evidence.amount.nominalEur, 150, 'Dokumentierte Grundbedarfslücke');
    const stress = analyze([base(1, { tailRiskApplied: true, tailRiskEventId: 'crash', tailRiskReturnShockPct: -20, tailRiskInflationShockPct: 3 }),
        base(2, { tailRiskActive: true, tailRiskApplied: false, tailRiskSkippedReason: 'historical_crisis' })]);
    assertEqual(one(stress, 'tail_risk_overlay').evidence.returnShockPct, -20, 'Angewandter Modellschock');
    assertEqual(byType(stress, 'tail_risk_overlay').length, 1, 'Ausgelassener Schock ist nicht angewandt');
    assertEqual(byType(stress, 'tail_risk_skipped').length, 1, 'Ausgelassenen Schock getrennt nennen');
}
{
    const input = freeze(scenario([base(1, { inflation: 10, kaufGld: 220 })]));
    const logs = freeze({ characteristic: [input], random: [] });
    const nominal = analyzeMonteCarloScenario(logs, 'char_p50', { moneyBasis: 'nominal' });
    const real = analyzeMonteCarloScenario(logs, 'char_p50', { moneyBasis: 'real' });
    assertEqual(JSON.stringify(nominal.sourceIdentity), JSON.stringify(real.sourceIdentity), 'Euro-Schalter ändert den Quellpfad nicht');
    assertClose(one(real, 'gold_purchase').evidence.amount.valueEur, 200, 1e-9, 'Reale Anzeigebeträge verwenden die Jahresendbasis');
    assertEqual(one(nominal, 'gold_purchase').evidence.amount.valueEur, 220, 'Nominale Anzeigebeträge');
    assertEqual(one(real, 'gold_purchase').evidence.amount.nominalEur, 220, 'Nominaler Beleg bleibt erhalten');
    assertEqual(analyzeMonteCarloScenario(logs, 'char_p10').available, false, 'Fehlende Auswahl wird nicht durch anderen Pfad ersetzt');
    assertEqual(analyzeMonteCarloScenario({ characteristic: [input], random: [input] }, 'p50').available, false, 'Mehrdeutige Kurzkennung bleibt unbekannt');
    const missingPrice = analyze([base(1, { inflation: null, kaufGld: 220 })], { moneyBasis: 'real' });
    assertEqual(one(missingPrice, 'gold_purchase').evidence.amount.valueEur, null, 'Keine nominale Ersatzanzeige im Realmodus');
    for (const model of [real, analyze([]), analyzeScenario(null), analyzeBacktest(null)]) {
        assert(model.summarySentences.length >= 3 && model.summarySentences.length <= 6, 'Zusammenfassung hat drei bis sechs Sätze');
        for (const event of model.events) {
            assertEqual(event.ruleVersion, LOG_ANALYSIS_RULE_VERSION, 'Regelversion an jedem Ereignis');
            assert(event.sourceRefs.length > 0 && !!event.text && !!event.label, 'Jedes Ereignis hat Quelle und Alltagstext');
        }
    }
    const rich = analyze([base(1, { ...cut(20), flex_haushalt_erfuellt: 90, RunwayCoveragePct: 80, portfolio_total_end: 900 }),
        base(2, cut(30)), base(3, { ...cut(40), steuern_gesamt: 3000 })]);
    assertEqual(rich.prioritizedEvents.slice(0, 4).map(event => event.type).join(),
        'floor_covered,below_minimum_flex_phase,decision_flex_cut_phase,minimum_real_year_end_wealth', 'Feste Priorität: Grundbedarf, Mindest-Flex, längste Kürzung, reales Tief');
    assertEqual(rich.events[0].rowIndex, 0, 'Chronologische Belege bleiben getrennt von Kartenpriorität');
    const notObserved = analyze([base(1), { jahr: 2, row: null }, base(3)]);
    assertEqual(notObserved.financialYears, 2, 'Explizit fehlende Wrapperzeile wird nicht als Finanzjahr gelesen');
    assertEqual(notObserved.missingness.row[0], 1, 'Missingness nennt fehlenden Wrapper');
    const error = analyzeBacktest({ outcome: { kind: 'technical_error' }, rows: [base(2000)] });
    assert(!!one(error, 'technical_error') && !error.floorCovered, 'Technischer Ergebnisfehler auch ohne eigene Fehlerzeile');
    const noEarlyYears = analyze([base(3, { portfolio_total_end: 800 }), base(4)]);
    assert(!one(noEarlyYears, 'real_wealth_recovery'), 'Kein Erholungsbeginn aus einem fehlenden Pfadanfang');
}
