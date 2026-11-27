// HP-5: Aufteilung wie „Deine Reserven“, Satz zur längsten Kürzung, restliche englische Wörter. Nur synthetische Beispielhaushalte.
import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords, rebuildSyntheticPriceRecords } from '../app/demo/muster-haushalt.js';
import { annualRecordStorage, computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { liquidityDisplayContext } from '../app/balance/balance-play-execution.js';
import { syntheticAnnualQuote, syntheticAnnualInflation, syntheticAnnualCape, SYNTHETIC_MARKET_SOURCE } from '../app/shared/probelauf-prices.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { HANDBOOK_MUSTER_DATE } from '../app/demo/muster-haushalte.js';
import { createAnnualTodoResult } from '../app/shared/annual-close-result.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';
import { renderCard, clean, editRegistry } from './helpers/wt-1-balance-render.mjs';

const euro = text => Number(String(text).replaceAll('.', ''));

// Punkt 1 (FR-78 Ergänzung 7): Jan und Lena, Grundfall, am Handbuchdatum angelegt, Sprung auf den 02.01.2027, Jahresabschluss 2026
// gespeichert, Tagesgeldstände nur bestätigt. „Wohin das Geld geht“ im Ergebnis teilt wie „Deine Reserven“: Tagesgeld = nach Umsetzung
// minus heute, Geldmarkt = Rest bis zum Kopf. Zweiter Lauf mit erfundenem Tagesgeld 20.745 € bei Lena (heute 55.745 €, wie im Befund).
// Beide Karten teilen den Zufluss je Person auf.
for (const [label, lenaCash, expected] of [['Grundfall', null, [60000, 67500, 7500, 82500]], ['Lena 20.745 €', 20745, [55745, 67745, 12000, 78000]]]) {
    const DATE = '2027-01-02', now = () => new Date(`${DATE}T12:00:00Z`);
    const marketData = {
        inflation: { ...syntheticAnnualInflation(2026, DATE), fetchStatus: 'ok_primary_ecb', metric: 'consumer_prices_all_items_annual_average_growth_pct' },
        etf: { ...syntheticAnnualQuote('VWCE.DE', 2026, DATE), source: SYNTHETIC_MARKET_SOURCE },
        cape: { ...syntheticAnnualCape(2026, DATE), capeFetchStatus: 'ok_primary', capeUpdatedAt: now().toISOString() } };
    let records = rebuildSyntheticPriceRecords(createMusterHaushaltRecords(HANDBOOK_MUSTER_DATE, 'jan-lena'), DATE);
    if (lenaCash !== null) records = editRegistry(records, registry => { registry.profiles.muster_lena.data.profile_tagesgeld = String(lenaCash); });
    const key = CONFIG.STORAGE.LS_KEY, state = JSON.parse(records[key]);
    state.annualPeriodMetadata = { schemaVersion: 1, ...(state.annualPeriodMetadata || {}),
        pendingCommit: { periodId: 'calendar-year:2026', snapshotId: 'hp5-before', phase: 'writes_started' } };
    records[key] = JSON.stringify(state);
    setAppTestDate(DATE);
    let result = '';
    try {
        const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData, storage: annualRecordStorage(records), now });
        const commit = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, now });
        Object.assign(records, commit.records);
        // Kontext wie im Abschluss (`annual-coordinator.js`): Werte der gespeicherten Rechnung.
        const calculation = commit.result;
        const liquidityContext = liquidityDisplayContext({ input: calculation.inputData, spending: calculation.modelResult.ui.spending,
            targetLiquidity: calculation.modelResult.ui.zielLiquiditaet,
            entries: calculation.profilverbundRuns?.map(run => ({ profileId: run.profileId, input: run.input,
                action: run.ui.action, spending: run.ui.spending, targetLiquidity: run.ui.zielLiquiditaet })) });
        const people = Object.entries(JSON.parse(records.rs_profiles_v1).profiles).map(([id, profile]) => ({ id, name: profile.name }));
        result = clean(createAnnualTodoResult(new MockDocument(), { year: 2027, action: commit.receipt.adopted.action, people, liquidityContext }).textContent);
    } finally { setAppTestDate(null); }
    const card = await renderCard(records, DATE);
    const reserves = /Tagesgeld([\d.]+) €→([\d.]+) €Geldmarkt([\d.]+) €→([\d.]+) €/.exec(clean(card.doc.getElementById('balanceReserveParts').textContent));
    const split = /Aufs Tagesgeld bis zum Tagesgeldziel([\d.]+) €Der Rest in den Geldmarkt([\d.]+) €/.exec(result);
    assert(reserves && split && result.includes('Aktien verkaufenca. 90.000 €netto'), `HP-5 ${label}: Ergebnis und „Deine Reserven“ lesbar (${result.slice(0, 320)})`);
    const [cashToday, cashAfter, moneyToday, moneyAfter] = reserves.slice(1).map(euro);
    assertEqual(euro(split[1]), cashAfter - cashToday, `HP-5 ${label}: Tagesgeld im Ergebnis = „Deine Reserven“ nach Umsetzung minus heute`);
    assertEqual(euro(split[2]), moneyAfter - moneyToday, `HP-5 ${label}: Geldmarkt im Ergebnis = „Deine Reserven“ nach Umsetzung minus heute`);
    assertEqual([cashToday, cashAfter, euro(split[1]), euro(split[2])].join(' / '), expected.join(' / '),
        `HP-5 ${label}: Tagesgeld aus der Aufteilung je Person, der Geldmarkt den Rest bis zum Kopf 90.000 €`);
}

// Punkt 2: Satz zur längsten Kürzung. Gemeint ist die größte Kürzung in einem Jahr; bei 100 % fiel die Flex-Entnahme ganz weg.
// Derselbe Text steht im Monte Carlo und im Backtest. Erfundene Belege.
{
    const { describeLogAnalysisEvent } = await import('../app/simulator/log-analysis-texts.js');
    const cut = (source, maximumAnnualValue, openAtEnd = false) => describeLogAnalysisEvent({ type: 'decision_flex_cut_phase', source, year: 12,
        evidence: { startYear: 12, endYear: 16, durationYears: 5, maximumAnnualValue, openAtEnd } }).text;
    assertEqual(cut('monte_carlo', 100), 'Die vorgesehene Flex-Entnahme aus dem Vermögen wird von Simulationsjahr 12 bis Simulationsjahr 16 in 5 Jahren um mindestens 10 % gekürzt, in einem Jahr fiel die Flex-Entnahme ganz weg.',
        'HP-5 längste Kürzung: bei 100 % fiel die Flex-Entnahme in einem Jahr ganz weg');
    assertEqual(cut('monte_carlo', 37.5), 'Die vorgesehene Flex-Entnahme aus dem Vermögen wird von Simulationsjahr 12 bis Simulationsjahr 16 in 5 Jahren um mindestens 10 % gekürzt, in einem Jahr um bis zu 37,5 %.',
        'HP-5 längste Kürzung: unter 100 % „in einem Jahr um bis zu …“');
    assertEqual(cut('backtest', 100, true), 'Die vorgesehene Flex-Entnahme aus dem Vermögen wird von 12 bis 16 in 5 Jahren um mindestens 10 % gekürzt und noch am Laufende, in einem Jahr fiel die Flex-Entnahme ganz weg.',
        'HP-5 längste Kürzung: Backtest mit demselben Satz');
    assert(!cut('backtest', 30).includes('jährlich höchstens') && cut('backtest', 30).endsWith('in einem Jahr um bis zu 30 %.'), 'HP-5 längste Kürzung: Backtest unter 100 %');
}

// Punkt 3: Restliche englische Wörter heißen wie die Begriffe der App (Handbuch-Glossar, Monte-Carlo-Einstellungen, Szenario-Protokoll).
// Export-Spaltenköpfe und interne Schlüssel bleiben.
{
    const { readFileSync } = await import('node:fs');
    const pages = Object.fromEntries(['Balance.html', 'Simulator.html', 'depot-tranchen-manager.html']
        .map(name => [name, readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')]));
    for (const [name, html] of Object.entries(pages)) {
        assert(!/Grundbedarf \(Floor\)|>Seed\b|Seed je Lauf|Szenario-Logs|Szenariolog/.test(html), `HP-5 ${name}: kein „(Floor)“, „Seed“ oder „Szenario-Logs“ mehr`);
    }
    assert(pages['Simulator.html'].includes('<label for="mcSeed">Zufallsstartwert</label>') && pages['Simulator.html'].includes('data-mc-view="logs">Szenario-Protokolle</button>'),
        'HP-5 Simulator: Zufallsstartwert (Glossar) und Unterreiter „Szenario-Protokolle“');
    const { HOUSEHOLD_PLAN_FIELDS } = await import('../app/shared/household-plan-fields.js');
    assertEqual(HOUSEHOLD_PLAN_FIELDS.find(field => field.path === 'floorBedarf')?.label, 'Grundbedarf', 'HP-5 Personen & Vermögen: „Grundbedarf“ ohne „(Floor)“');
    const { buildKpiDashboard } = await import('../app/simulator/results-metrics.js');
    const dashboard = buildKpiDashboard({ extraKPI: { tailRisk: { runActiveRatePct: 50, runAppliedRatePct: 25, activeYears: 3, evaluatedYears: 100 },
        dynamicFlexSafety: { yearShareStage1plus: 0.1, yearShareStage2: 0.01, runShareStage2: 0.05 } } }, { tailRiskEnabled: true });
    const titles = dashboard.detailSections.map(section => section.title), descriptions = JSON.stringify(dashboard);
    assert(titles.includes('Zusätzliche Extremereignisse') && !descriptions.includes('Overlay') && !descriptions.includes('Sicherheitsmodus')
        && descriptions.includes('Sicherheitsstufe 1 oder 2 von Dynamic Flex aktiv'), `HP-5 Monte Carlo: „Zusätzliche Extremereignisse“ statt „Tail-Risk-Overlay“, ⓘ mit Sicherheitsstufe (${titles.join(', ')})`);
    const { formatThresholdLabel } = await import('../app/balance/balance-diagnosis-transaction.js');
    assertEqual(formatThresholdLabel('maxAllocPctOfEq'), 'Max. Allokation (% des Aktienwerts)', 'HP-5 Diagnose: „(Eq)“ heißt „(% des Aktienwerts)“');
    assertEqual(formatThresholdLabel('maxBearRellicOfEq'), 'Weitere Angabe', 'HP-5 Diagnose: verschriebener toter Eintrag entfernt');
}
