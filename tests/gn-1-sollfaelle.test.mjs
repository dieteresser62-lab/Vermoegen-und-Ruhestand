// GN-1 Teil A (FR-68 Punkt 7 geändert): Vorschläge im Jahresabschluss werden genau gespeichert und fortgeschrieben, angezeigt nach der Anzeigestaffel.
import { balanceStorageFixture } from './helpers/balance-storage-fixtures.mjs';
import { computeAnnualPlanUpdate, annualRecordStorage } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { annualNeedSuggestions, roundAnnualSuggestion, ANNUAL_NEED_PATHS } from '../app/shared/annual-needs-review.js';
import { EngineAPI } from '../engine/index.mjs';
import { CONFIG } from '../app/balance/balance-config.js';
import { HOUSEHOLD_PLAN_KEY, buildPlanRecord, readBalanceHouseholdPlan } from '../app/profile/household-plan.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';

const marketFor = (year, rate) => {
    const now = new Date(`${year + 1}-01-02T12:00:00Z`);
    return { inflation: { rate, year, source: 'ECB (HICP)', dataAsOf: `${year + 1}-01-01`, fetchStatus: 'ok_primary_ecb',
        metric: 'consumer_prices_all_items_annual_average_growth_pct' },
    etf: { price: 160 + year - 2026, date: new Date(`${year}-12-31`), asOf: `${year}-12-31`, ticker: 'VWCE.DE', source: 'Test', targetYear: year },
    cape: { capeRatio: 28.5, capeAsOf: `${year}-12-01`, capeSource: 'yale_ie_data_xls', capeFetchStatus: 'ok_primary', capeUpdatedAt: now.toISOString() } };
};
const closeYear = (storage, year, rate) => {
    const now = () => new Date(`${year + 1}-01-02T12:00:00Z`);
    const state = JSON.parse(storage.getItem(CONFIG.STORAGE.LS_KEY));
    state.annualPeriodMetadata = { schemaVersion: 1, ...(state.annualPeriodMetadata || {}),
        pendingCommit: { periodId: `calendar-year:${year}`, snapshotId: `gn1-before-${year}`, phase: 'writes_started' } };
    storage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(state));
    const draft = computeAnnualPlanUpdate({ targetYear: year, marketData: marketFor(year, rate), storage, now });
    const commit = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, now });
    return { draft, commit, storage: annualRecordStorage({ ...storage.records, ...commit.records }) };
};

// Sollfall 1: zehn Jahresabschlüsse, je 2 % Inflation, jedes Mal „Plan + Inflation“ übernommen (kein Planpatch).
{
    const fixture = balanceStorageFixture('Muster-Haushalt');
    const start = { floorBedarf: 24000, flexBedarf: 12000, minimumFlexAnnual: 3000 };
    fixture.records[HOUSEHOLD_PLAN_KEY] = buildPlanRecord(null, [{ scope: fixture.scope, values: { ...fixture.values, ...start } }],
        { now: () => new Date('2026-12-30T12:00:00Z') }).raw;
    const state = JSON.parse(fixture.records[CONFIG.STORAGE.LS_KEY]);
    state.annualPeriodMetadata = { schemaVersion: 1, lastCommittedPeriod: null };
    fixture.records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
    fixture.records[CONFIG.STORAGE.MIGRATION_FLAG] = '1';
    fixture.records.balance_expenses_v1 = JSON.stringify({ version: 1, activeYear: 2026, years: { '2026': { months: {} } } });
    let storage = annualRecordStorage(fixture.records);
    for (let index = 0; index < 10; index++) {
        const year = 2026 + index, result = closeYear(storage, year, 2);
        const stored = readBalanceHouseholdPlan({ storage: result.storage }).entry.values;
        for (const path of ANNUAL_NEED_PATHS) {
            // Vorschlag, wie ihn der Jahresabschluss auf dem Knopf „Plan + Inflation“ anbietet, ist genau der gespeicherte Wert.
            const suggestion = annualNeedSuggestions({ inflation: { rate: 2 } }, null, path, result.draft.values[path]).plan;
            assertEqual(stored[path], suggestion, `${year}/${path}: gespeichert wird der genaue Vorschlag`);
            assertEqual(result.commit.receipt.adopted.snapshot.plan[path], suggestion, `${year}/${path}: Beleg enthält den genauen Vorschlag`);
        }
        assert(!result.commit.receipt.adjusted, `${year}: stehender Vorschlag ist keine Plananpassung`);
        storage = result.storage;
    }
    const final = readBalanceHouseholdPlan({ storage }).entry.values;
    console.log('GN-1 zehn Jahre', JSON.stringify({ floorBedarf: final.floorBedarf, flexBedarf: final.flexBedarf, minimumFlexAnnual: final.minimumFlexAnnual }));
    assertClose(final.floorBedarf, 29256, 5, 'GN-1: Grundbedarf nach zehn Jahren 29.256 € ± 5 € (bisher 34.000 €)');
    assertClose(final.flexBedarf, 14628, 5, 'GN-1: Flex nach zehn Jahren 14.628 € ± 5 € (bisher 22.000 €)');
    assertClose(final.minimumFlexAnnual, 3657, 5, 'GN-1: Mindest-Flex nach zehn Jahren 3.657 € ± 5 € (bisher 13.000 €)');
}

// Sollfall 2: Renate, Bedarf 2026 24.000 / 12.000 / 3.000 €, Inflation 2,5 % → gespeichert 24.600 / 12.300 / 3.075 €,
// angezeigt nach Anzeigestaffel (Nachtrag 1) 25.000 / 13.000 / 3.250 €.
{
    const records = createMusterHaushaltRecords('2026-12-30', 'renate');
    const before = readBalanceHouseholdPlan({ storage: annualRecordStorage(records) }).entry.values;
    assertEqual(JSON.stringify([before.floorBedarf, before.flexBedarf, before.minimumFlexAnnual]), JSON.stringify([24000, 12000, 3000]), 'Renate: Ausgangswerte wie im Gutachten');
    const result = closeYear(annualRecordStorage(records), 2026, 2.5);
    const stored = readBalanceHouseholdPlan({ storage: result.storage }).entry.values;
    assertEqual(JSON.stringify([stored.floorBedarf, stored.flexBedarf, stored.minimumFlexAnnual]), JSON.stringify([24600, 12300, 3075]), 'GN-1 Renate: gespeichert 24.600 / 12.300 / 3.075 €');
    assertEqual(JSON.stringify(ANNUAL_NEED_PATHS.map(path => roundAnnualSuggestion(stored[path]))), JSON.stringify([25000, 13000, 3250]), 'GN-1 Renate: angezeigt 25.000 / 13.000 / 3.250 €');
}

// ---------------------------------------------------------------------------------------------------------------
// GN-1 Teil B (Ergänzung 3 FR-78): Prozent aus der Anzeige, Budgetzeile geht auf, erledigte Zeile mit Rest, Käufe im Zufluss.
import { renderCard, clean, overviewModel } from './helpers/wt-1-balance-render.mjs';
import { MockDocument } from './helpers/balance-page-fixture.mjs';
import { overviewLiquidityText, overviewCoverages } from '../app/overview/overview-renderer.js';
import { displayedCoverage, displayedReserveView } from '../app/balance/balance-reserves.js';
import { displayedWithdrawal } from '../app/shared/display-rounding.js';
import { createTodoPlan } from '../app/shared/annual-todo-view.js';

{
    // Sollfall Max und Erika am 23.10.2026: 180.000 € zu 165.000 € → 109 %, Balance und Übersicht gleich (bisher 111 % bzw. 110,2 %; HP-3: 179.500 → 180.000 €, Kopf aus der Summe der Zeilen).
    const date = '2026-10-23', records = createMusterHaushaltRecords(date, 'max-erika');
    const card = await renderCard({ ...records }, date);
    const text = id => clean(card.doc.getElementById(id)?.textContent || '');
    assert(text('balanceReserveValues').includes('nach Umsetzung180.000 €') && text('balanceReserveTarget').includes('= 165.000 €'), `GN-1: Reserven 180.000 € zu Ziel 165.000 € (${text('balanceReserveValues')})`);
    assert(text('balanceReserveCoverage').includes('nach Umsetzung 109 %') && text('balanceReserveCoverage').includes('heute 55 % gedeckt'),
        `GN-1: Balance „nach Umsetzung 109 %“ aus den angezeigten Beträgen (${text('balanceReserveCoverage')})`);
    const model = await overviewModel(records, date);
    assertEqual(clean(overviewLiquidityText(model.summary, overviewCoverages(model).plan)), '55 % heute · 109 % nach Umsetzung', 'GN-1: Übersicht zeigt dieselbe Deckung wie die Balance');
    // Sollfall Budgetzeile: Budget 5.000 € mit „Einkünfte 3.100 € · aus dem Vermögen 1.900 €“ (bisher 2.000 €).
    assertEqual(`${text('balanceMonthlyBudget')} | ${text('balanceMonthlyIncome')} | ${text('monatlicheEntnahme')}`, '5.000 € | 3.100 € | 1.900 €', 'GN-1: Budgetzeile geht auf: 5.000 − 3.100 = 1.900 €');
}
{
    // Deckung: erreicht der genaue Wert 100 %, steht nie weniger als 100 %.
    assertEqual(Math.round(displayedCoverage(179500, 165000, 178446, 162000)), 109, 'GN-1: Deckung aus angezeigten Beträgen');
    assertEqual(displayedCoverage(160000, 165000, 162000, 162000), 100, 'GN-1: Ziel genau erreicht → nicht unter 100 %');
    assert(displayedCoverage(150000, 165000, 150000, 162000) < 100, 'GN-1: echte Lücke bleibt unter 100 %');
    // Budgetzeile nie negativ.
    assertEqual(displayedWithdrawal(2000, 5100), 1900, 'GN-1: Entnahme = angezeigtes Budget − Einkünfte');
    assertEqual(displayedWithdrawal(20, 3120), 0, 'GN-1: Entnahme nie negativ');
}
{
    // Erledigte Planzeile mit Rest: Plan 79.950 €, verkauft 74.950 € → erledigt, fehlend 5.000 € (VN-1 Punkt 4: Zeilen auf den Euro, vorher 80.000 € und 5.050 €).
    const row = { who: 'Erika', security: 'Muster Aktien-ETF', planNet: 79950, soldNet: 74950, restNet: 5000, status: 'erledigt', lastSaleAt: '2027-03-02T10:00:00Z', profileId: 'b', trancheId: null };
    const plan = { year: 2027, decidedOn: '02.01.2027', status: 'erledigt', rows: [row], planNet: 79950, soldNet: 74950, restNet: 5000, verb: 'Aktien verkaufen', amount: 79950,
        purchases: [], destinations: [], credits: [], openSecurities: [], tax: 0, lastSaleDate: '02.03.2027' };
    const shown = clean(createTodoPlan(new MockDocument(), plan).textContent);
    assert(shown.includes('79.950 €') && shown.includes('5.000 € weniger als geplant'), `GN-1: erledigte Zeile nennt 5.000 € (${shown.slice(0, 300)})`);
    const exceeded = clean(createTodoPlan(new MockDocument(), { ...plan, rows: [{ ...row, soldNet: 79960, restNet: 0 }] }).textContent);
    assert(!exceeded.includes('weniger als geplant'), 'GN-1: mehr als geplant verkauft → kein Rest');
}
{
    // N3: Plan mit Verkäufen und einem Kauf aus dem Erlös. „Nach Umsetzung“ = heute + angezeigte Verkäufe − angezeigter Kauf.
    const view = { before: { tagesgeld: 30000, geldmarkt: 60000, liquidity: 90000 }, after: { tagesgeld: 32400, geldmarkt: 144912, liquidity: 177312 },
        targets: [], target: 162000 };
    const todoPlan = { rows: [{ restNet: 9362 }, { restNet: 79950 }], purchases: [{ label: 'In Gold', amount: 2000, purchase: true }] };
    const result = displayedReserveView(view, todoPlan);
    // HP-3 (Ergänzung 6 FR-78): Verkäufe wie der Kopf der Karte, 9.362 + 79.950 = 89.312 € einmal aufgerundet (vorher 9.500 + 80.000 €).
    assertEqual(result.shown.after.liquidity, 90000 + 90000 - 2000, 'GN-1: Liquidität nach Umsetzung = 90.000 + 90.000 − 2.000 €');
}

// ---------------------------------------------------------------------------------------------------------------
// GN-1 Teil C2 (N2): Renate, „Gesamtvermögen zu Beginn“ zählt die Anleihen einmal: 350.000 € statt 495.000 €.
import { calculateAggregatedValues } from '../app/tranches/depot-tranchen-status.js';
import { projectStartAllocation } from '../app/simulator/simulator-portfolio-display.js';
{
    const records = createMusterHaushaltRecords('2026-10-23', 'renate');
    const data = Object.values(JSON.parse(records.rs_profiles_v1).profiles)[0].data;
    const aggregated = calculateAggregatedValues(JSON.parse(data.depot_tranchen));
    const parts = projectStartAllocation({ depotAlt: aggregated.depotwertAlt, depotNeu: aggregated.depotwertNeu, gold: aggregated.goldWert,
        liquidity: Number(data.profile_tagesgeld) + aggregated.geldmarktEtf, bonds: aggregated.bondsWert });
    const total = parts.reduce((sum, value) => sum + value, 0);
    assertEqual(total, 350000, 'GN-1 N2: Renate Gesamtvermögen zu Beginn 350.000 € (bisher 495.000 €)');
    assertEqual(parts[3], 145000, 'GN-1 N2: Anleihen 145.000 € einmal');
    assertClose(parts.reduce((sum, value) => sum + value / total * 100, 0), 100, 1e-9, 'GN-1 N2: Anteile zusammen 100 %');
}

// ---------------------------------------------------------------------------------------------------------------
// GN-1 Teil C4 (N7): Sterblichkeits-Untergrenze bei Pflegegrad heute auch für die zweite Person (mc-life-events.js, Aufruf für P2).
// Partnerin 95 Jahre, Pflegegrad 2 heute, Verlauf „deutlich langsamer“: ohne Untergrenze läge ihre Sterbewahrscheinlichkeit unter
// der Zieltafel. Die Ziehung liegt genau zwischen beiden Werten: Mit Untergrenze stirbt sie, ohne überlebt sie.
import { inputs as parityFixture } from './extended/parity-replay-fixture.mjs';
import { createMonteCarloLifeState, updateMonteCarloLifeEventsForYear } from '../app/simulator/mc-life-events.js';
import { computeCareMortalityMultiplier } from '../app/simulator/simulator-engine-wrapper.js';
import { resolveBaseMortalityProbability, resolveTargetMortalityProbability, resolveInputsPersonBirthYear } from '../app/simulator/target-mortality.js';
import { rng } from '../app/simulator/simulator-utils.js';
{
    const inputs = { ...structuredClone(parityFixture), startAlter: 70, geschlecht: 'm',
        partner: { ...parityFixture.partner, aktiv: true, startAlter: 95, geschlecht: 'w',
            careToday: { grade: 2, additionalMonthly: null, progression: 'much_slower', allowanceAsIncome: false } },
        pflegefallLogikAktivieren: true, pflegeModellTyp: 'akut', pflegeMinDauer: 1, pflegeMaxDauer: 1, pflegeKostenDrift: .035,
        pflegeRegionalZuschlag: .1, pflegeMaxFloor: 1000000, pflegeRampUp: 5,
        pflegeGradeConfigs: Object.fromEntries([1, 2, 3, 4, 5].map((grade, i) => [grade,
            { zusatz: [6000, 12000, 18000, 32000, 60000][i], flexCut: [1, 1, .5, 0, 0][i], mortalityFactor: [1.5, 2, 3, 4, 5][i] }])) };
    const state = createMonteCarloLifeState(inputs, rng(1));
    const withoutFloor = Math.min(1, resolveBaseMortalityProbability(inputs, 1, 'w', 95) * computeCareMortalityMultiplier(state.careMetaP2, inputs));
    const target = resolveTargetMortalityProbability('w', 95, resolveInputsPersonBirthYear(inputs, 1));
    assert(withoutFloor < target, `N7: ohne Untergrenze unter der Zieltafel (${withoutFloor.toFixed(4)} < ${target.toFixed(4)})`);
    const draw = (withoutFloor + target) / 2; let calls = 0;
    // Erste Ziehung: Person 1 überlebt; zweite Ziehung: Partnerin.
    const rand = () => ++calls === 2 ? draw : .999999;
    updateMonteCarloLifeEventsForYear(state, inputs, inputs.widowOptions, 0, { jahr: 2000, inflation: 2, rendite: .04, gold_eur_perf: 0, zinssatz: .02, lohn: 0 },
        0, null, false, rand, {});
    assertEqual(calls, 2, 'N7: genau zwei Todesziehungen');
    assert(state.p1Alive, 'N7: Person 1 überlebt');
    assertEqual(state.p2Alive, false, 'N7: Partnerin mit Pflegegrad heute stirbt mindestens mit der Zieltafel (Untergrenze für Person 2)');
}

// ---------------------------------------------------------------------------------------------------------------
// GN-1 Teil C1 (S3) und C3 (N5): Annahmen unter der Deckungsquote, deutsche Namen, „Ø Laufzeit“. Nur Anzeige.
import { buildMonteCarloAnswers, buildKpiDashboard } from '../app/simulator/results-metrics.js';
import { coverageAssumptions, runLabel, stressLabel } from '../app/simulator/simulator-assumption-lines.js';
import { renderMonteCarloAnswers } from '../app/simulator/results-renderers.js';
{
    const inputs = { rentAdjMode: 'cpi', rentAdjPct: 0, equityCostPct: 0.5, pflegefallLogikAktivieren: true, pflegeKostenDrift: 0.015 };
    const results = { extraKPI: { pflege: { household: { shortfallRateWithCarePct: 50, sampleSize: 40, shortfallRateWithoutCarePct: 10, noCareSampleSize: 60 } } } };
    const view = coverageAssumptions(inputs, results);
    assertEqual(view.line, 'Gerechnet mit: Rentenanpassung wie Inflation · Fondskosten 0,5 % im Jahr · Pflegekosten Inflation + 1,5 % · Lebensdauer nach der Sterbetafel des Jahrgangs (Destatis), Simulation bis Alter 110 der jüngsten Person.',
        'GN-1 S3: Zeile „Gerechnet mit“ nennt Rentenanpassung, Fondskosten, Pflegekosten und Lebensdauer');
    assertEqual(view.careShare, 'Von 26 Läufen, in denen das Geld nicht reicht oder Aktien und Gold aufgebraucht sind, hatten 20 einen Pflegefall.', 'GN-1 S3: Anteil der Pflegefälle an den gescheiterten Läufen');
    assertEqual(view.wageHint, '', 'GN-1 S3: ohne „wie Löhne“ kein Lohnhinweis');
    assert(coverageAssumptions({ ...inputs, rentAdjMode: 'wage' }).wageHint.includes('Vorsichtiger ist „wie Inflation“'), 'GN-1 S3: „wie Löhne“ bringt den vorhandenen Hinweis');
    assert(coverageAssumptions({ rentAdjMode: 'fix', rentAdjPct: 1.5 }).line.includes('Rentenanpassung fester Satz 1,5 %'), 'GN-1 S3: fester Satz');
    assert(coverageAssumptions({ rentAdjMode: 'fix', rentAdjPct: 0 }).line.includes('Rentenanpassung keine'), 'GN-1 S3: keine Anpassung');
    assertEqual(`${runLabel('methode', 'regime_markov')} · ${runLabel('decumulation', '3_bucket_jilge')} · ${stressLabel('NONE')}`, 'Marktregime mit Übergängen · 3-Töpfe · Kein Stress', 'GN-1 S3: deutsche Namen statt Kürzel');
    // Die Antwort „Reicht das Vermögen?“ trägt die Zeile; der Renderer zeigt sie unter der Deckungsquote.
    const inventory = { schemaVersion: 'MonteCarloOutcomeInventoryV1', requestedRuns: 100, all_dead: 70, horizon_exhausted: 20, ruin: 10, technical_error: 0, floorCoveragePct: 90 };
    const answers = buildMonteCarloAnswers({ results: { ...results, outcomeInventory: inventory }, totalRuns: 100, failCount: 10, inputs });
    assertEqual(answers[0].assumptions?.line, view.line, 'GN-1 S3: Deckungsantwort trägt die Annahmen');
    const host = { id: 'monteCarloAnswers', innerHTML: '' };
    renderMonteCarloAnswers(host, answers);
    assert(host.innerHTML.includes('sim-coverage-assumptions') && host.innerHTML.includes('Fondskosten 0,5 % im Jahr'), 'GN-1 S3: Renderer zeigt die Annahmen unter der Deckungsquote');
    const dashboard = buildKpiDashboard({ kpiLebensdauer: { mean: 24.6 } });
    const life = [...(dashboard.primary || []), ...(dashboard.secondary || [])].find(item => item.title === 'Ø Laufzeit');
    assert(life && life.description.startsWith('Bis zum Tod oder bis das Geld nicht mehr reicht'), 'GN-1 N5: „Ø Laufzeit“ mit Erklärung');
}
