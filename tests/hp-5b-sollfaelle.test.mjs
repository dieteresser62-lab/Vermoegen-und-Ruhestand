// HP-5b: Anzeige des Verkaufszuflusses, Übersicht und Texte. Nur synthetische Beispielhaushalte.
import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords, rebuildSyntheticPriceRecords } from '../app/demo/muster-haushalt.js';
import { annualRecordStorage, computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { liquidityDisplayContext } from '../app/balance/balance-play-execution.js';
import { syntheticAnnualQuote, syntheticAnnualInflation, syntheticAnnualCape, SYNTHETIC_MARKET_SOURCE } from '../app/shared/probelauf-prices.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { HANDBOOK_MUSTER_DATE } from '../app/demo/muster-haushalte.js';
import { createAnnualActionResult, createAnnualTodoResult } from '../app/shared/annual-close-result.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { overviewCoverages, overviewLiquidityText, overviewPlanView } from '../app/overview/overview-renderer.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';
import { renderCard, clean, editRegistry, overviewModel } from './helpers/wt-1-balance-render.mjs';

const euro = text => Number(String(text).replaceAll('.', ''));

const cases = [
    { household: 'max-erika', cash: { muster_a: 17729.55, muster_b: 9229.78 }, today: 26959, head: 35000,
        split: [10000, 25000], exactCash: '9.945,22 €', targets: 'Max 5.500 € · Erika 19.175 € · Summe 24.675 €' },
    { household: 'jan-lena', today: 60000, head: 90000, split: [7500, 82500] },
    { household: 'jan-lena', cash: { muster_lena: 20745 }, today: 55745, head: 90000, split: [12000, 78000] }
];
for (const sample of cases) {
    const { household, cash, today, head, split, exactCash, targets } = sample;
    const DATE = '2027-01-02', now = () => new Date(`${DATE}T12:00:00Z`);
    const marketData = {
        inflation: { ...syntheticAnnualInflation(2026, DATE), fetchStatus: 'ok_primary_ecb', metric: 'consumer_prices_all_items_annual_average_growth_pct' },
        etf: { ...syntheticAnnualQuote('VWCE.DE', 2026, DATE), source: SYNTHETIC_MARKET_SOURCE },
        cape: { ...syntheticAnnualCape(2026, DATE), capeFetchStatus: 'ok_primary', capeUpdatedAt: now().toISOString() } };
    let records = rebuildSyntheticPriceRecords(createMusterHaushaltRecords(HANDBOOK_MUSTER_DATE, household), DATE);
    if (cash) records = editRegistry(records, registry => {
        for (const [id, amount] of Object.entries(cash)) registry.profiles[id].data.profile_tagesgeld = String(amount);
    });
    const key = CONFIG.STORAGE.LS_KEY, state = JSON.parse(records[key]);
    state.annualPeriodMetadata = { schemaVersion: 1, ...(state.annualPeriodMetadata || {}),
        pendingCommit: { periodId: 'calendar-year:2026', snapshotId: 'hp5-before', phase: 'writes_started' } };
    records[key] = JSON.stringify(state);
    setAppTestDate(DATE);
    let result = '', details = '';
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
        const actionResult = { year: 2027, action: commit.receipt.adopted.action, people, liquidityContext };
        result = clean(createAnnualTodoResult(new MockDocument(), actionResult).textContent);
        details = clean(createAnnualActionResult({ doc: new MockDocument(), result: actionResult, compact: true }).textContent);
    } finally { setAppTestDate(null); }
    const card = await renderCard(records, DATE);
    const read = id => clean(card.doc.getElementById(id).textContent);
    const reserves = /Tagesgeld([\d.]+) €→([\d.]+) €Geldmarkt([\d.]+) €→([\d.]+) €/.exec(read('balanceReserveParts'));
    const amounts = /Aufs Tagesgeld bis zum Tagesgeldziel([\d.]+) €Der Rest in den Geldmarkt([\d.]+) €/.exec(result);
    const headText = head.toLocaleString('de-DE');
    assert(result.includes(`Aktien verkaufenca. ${headText} €netto`), `${household}: Kopf nennt ${headText} €`);
    assert(amounts && reserves, `${household}: Verkaufsergebnis und Reservenzeilen sind lesbar (${result.slice(0, 300)})`);
    const [cashToday, cashAfter, moneyToday, moneyAfter] = reserves.slice(1).map(euro);
    assertEqual(cashToday, today, `${household}: Tagesgeld heute`);
    assertEqual(amounts.slice(1).map(euro).join('/'), split.join('/'), `${household}: gerundete Aufteilung nach Person`);
    assertEqual(cashAfter - cashToday, split[0], `${household}: gleicher Tagesgeldzufluss in der Reservekarte`);
    assertEqual(moneyAfter - moneyToday, split[1], `${household}: gleicher Geldmarktzufluss in der Reservekarte`);
    assertEqual(euro(amounts[1]) + euro(amounts[2]), head, `${household}: beide Teile ergeben den Kopf`);
    if (exactCash) assert(details.includes(`davon Tagesgeld ${exactCash}`), `${household}: die Details nennen weiter den genauen Zufluss`);
    if (targets) assertEqual(read('balancePersonalCashTargets'), `Tagesgeldziel: ${targets}`, `${household}: kein Schein-Fehlbetrag für Erika`);
    const overview = await overviewModel(records, DATE);
    const comparison = overviewPlanView(overview).rows;
    const planNote = clean(comparison.find(row => row.label === 'Handlungsanweisung').plan);
    const planCoverage = clean(comparison.find(row => row.label.startsWith('Liquidität')).plan);
    assert(planNote.includes(`${headText} €`), `${household}: Planvergleich nennt denselben Verkaufskopf`);
    assert(read('balanceReserveCoverage').includes(`nach Umsetzung ${planCoverage}`), `${household}: Planvergleich nennt dieselbe Deckung nach Umsetzung`);
    assert(clean(overviewLiquidityText(overview.summary, overviewCoverages(overview).plan)).includes(`${planCoverage} nach Umsetzung`),
        `${household}: die Reservedeckung der Übersicht entspricht dem Planvergleich`);
}

{
    const { describeLogAnalysisEvent } = await import('../app/simulator/log-analysis-texts.js');
    const describe = (type, evidence = {}) => describeLogAnalysisEvent({ type, evidence, source: 'monte_carlo', year: 12 }).text;
    assertEqual(describe('extreme_bear'), 'Im Simulationsjahr 12 stuft die App den Markt als Extrembär ein.', 'Extrembär nennt die App');
    assertEqual(describe('market_regime_change', { from: 'Bulle', to: 'Bär' }), 'Im Simulationsjahr 12 wechselt die Marktphase der Rechnung von „Bulle“ zu „Bär“.', 'Marktphase der Rechnung mit Artikel');
    for (const [field, phrase] of Object.entries({
        SafetyCapActive: 'die Bereitschaft der Leitplanke', SafetyCapApplied: 'der Eingriff der Leitplanke',
        SevereFlexEmergencyActive: 'die Notfallregel für Flex', Alarm: 'der Alarm', safety_stage_current: 'die Sicherheitsstufe'
    })) {
        assertEqual(describe('policy_state_change', { field, from: false, to: true }),
            `Im Simulationsjahr 12 wechselt ${phrase} von inaktiv auf aktiv.`, `Statuswechsel mit Artikel für ${field}`);
        assertEqual(describe('initial_policy_observation', { field, to: true }),
            `Im Simulationsjahr 12 ist ${phrase} mit „aktiv“ protokolliert; der Beginn dieses Zustands ist nicht belegt.`, `Erste Beobachtung mit Artikel für ${field}`);
    }
}

{
    const result = createAnnualTodoResult(new MockDocument(), { year: 2027, action: {
        type: 'TRANSACTION', quellen: [{ kind: 'aktien_neu', brutto: 351, netto: 351 }], verwendungen: { liquiditaet: 351 }
    }, liquidityContext: { input: { tagesgeld: 0, geldmarktEtf: 0, personalTagesgeldTarget: 330 }, spending: { monatlicheEntnahme: 1 }, targetLiquidity: 50 } });
    assert(clean(result.textContent).includes('Alles aufs Tagesgeld bis zum Tagesgeldziel500 €'), 'Gerundeter Geldmarktrest ohne Platz ergibt die Zeile „Alles aufs Tagesgeld“');
}
