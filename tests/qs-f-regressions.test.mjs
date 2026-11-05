import { readyAnnualFixture, annualTestMarketData, annualTestNow, annualServiceFixture } from './helpers/balance-storage-fixtures.mjs';
import { annualRecordStorage, computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { evaluateAnnualDraft, prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { evaluateAnnualPlanPreview } from '../app/shared/annual-plan-editor.js';
import { captureCashPeople, prepareHouseholdCash } from '../app/profile/profile-cash-update.js';
import { CONFIG } from '../app/balance/balance-config.js';
import { EngineAPI } from '../engine/index.mjs';
import { applyFlexBudgetCap } from '../engine/planners/flex-budget-policy.mjs';
import { splitPlayLiquidity, preparePlayAction } from '../app/balance/balance-play-execution.js';
import { playFixture } from './helpers/probelauf-area-fixture.mjs';
import { ActionRenderer } from '../app/balance/balance-renderer-action.js';
import { createAnnualPeriodPlan } from '../app/balance/balance-annual-period.js';
import { PLAN_DEFAULTS, assertPlanValues } from '../app/profile/household-plan.js';
import { HOUSEHOLD_OWNED_BALANCE_STATE_KEYS } from '../app/profile/profile-storage.js';

// 1: Vorschau, Empfehlung, Beschluss, Summary und Bestände teilen dieselbe Cashbasis.
async function finding1() {
    for (const kind of ['Einzelprofil', 'Muster-Haushalt', 'aktive Außenperson']) {
        const sample = readyAnnualFixture(kind), storage = annualRecordStorage(sample.records);
        const before = JSON.stringify(storage.records), activeId = sample.records.rs_current_profile;
        const cash = { people: captureCashPeople({ storage, ids: sample.scope.ids, activeId }),
            values: Object.fromEntries(sample.scope.ids.map((id, index) => [id, 500000 + index * 10000])) };
        const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData: annualTestMarketData, storage, now: annualTestNow });
        const expectedStorage = annualRecordStorage(draft.records);
        const cashUpdate = prepareHouseholdCash({ storage: expectedStorage, registry: JSON.parse(expectedStorage.getItem('rs_profiles_v1')),
            activeId, ids: sample.scope.ids, checkMembership: sample.scope.kind === 'household', cash, date: '2027-01-02', recordConfirmation: true });
        for (const [key, raw] of Object.entries(cashUpdate.records)) expectedStorage.setItem(key, raw);
        expectedStorage.setItem('rs_profiles_v1', JSON.stringify(cashUpdate.registry));
        const expected = evaluateAnnualDraft({ ...draft, records: expectedStorage.records }, { engineApi: EngineAPI, now: annualTestNow });
        const committedDraft = { ...draft, records: { ...draft.records } };
        const state = JSON.parse(committedDraft.records[CONFIG.STORAGE.LS_KEY]);
        state.annualPeriodMetadata.pendingCommit = { periodId: draft.periodId, snapshotId: 'qs-f-before', phase: 'writes_started' };
        committedDraft.records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
        const prepared = prepareAnnualCommitRecords(committedDraft, { engineApi: EngineAPI, cash,
            adoptedPlanPatch: { flexBedarf: draft.values.flexBedarf + 1000 }, now: annualTestNow });
        assertEqual(JSON.stringify(prepared.receipt.recommended), JSON.stringify(expected.outcome), `QS-F 1 ${kind}: Empfehlung mit bestätigtem Tagesgeld`);
        const adopted = evaluateAnnualDraft({ ...draft, records: expectedStorage.records }, { engineApi: EngineAPI,
            adoptedPlanPatch: { flexBedarf: draft.values.flexBedarf + 1000 }, now: annualTestNow });
        assertEqual(JSON.stringify(prepared.result.modelResult), JSON.stringify(adopted.modelResult), `QS-F 1 ${kind}: übernommener Plan mit derselben Vermögensbasis`);
        assertEqual(prepared.result.inputData.tagesgeld, Object.values(cash.values).reduce((a, b) => a + b, 0), `QS-F 1 ${kind}: Engine-Cash entspricht bestätigten Personenständen`);
        const preview = await evaluateAnnualPlanPreview({ targetYear: 2026, marketData: annualTestMarketData, cash, storage,
            now: annualTestNow, engineLoader: { load: async () => EngineAPI } });
        assertEqual(JSON.stringify(preview.recommended), JSON.stringify(expected.outcome), `QS-F 1 ${kind}: Vorschau entspricht späterem Beleg`);
        for (const id of sample.scope.ids) assertEqual(JSON.parse(prepared.records.rs_profiles_v1).profiles[id].data.profile_tagesgeld,
            String(cash.values[id]), `QS-F 1 ${kind}/${id}: persönlicher Cashstand gespeichert`);
        const summaries = JSON.parse(JSON.parse(prepared.records.rs_profiles_v1).profiles[sample.scope.ids[0]].data.overview_balance_summary_v1).entries;
        const summary = Object.values(summaries).find(entry => entry.year === 2027);
        assertEqual(summary.monthlyWithdrawal, adopted.outcome.monthlyWithdrawal, `QS-F 1 ${kind}: Übersicht verwendet den bestätigten Beschluss`);
        assertEqual(JSON.stringify(storage.records), before, `QS-F 1 ${kind}: Vorschau und Vorbereitung schreiben keine Livebytes`);
    }
    let household = annualRecordStorage(readyAnnualFixture().records), factor = 1;
    for (let year = 2026; year <= 2028; year++) {
        const now = () => new Date(`${year + 1}-01-02T12:00:00Z`);
        const marketData = { inflation: { ...annualTestMarketData.inflation, year, rate: 10 },
            etf: { ...annualTestMarketData.etf, targetYear: year, date: new Date(`${year}-12-31`), asOf: `${year}-12-31` },
            cape: { ...annualTestMarketData.cape, capeAsOf: `${year}-12-01`, capeUpdatedAt: now().toISOString() } };
        const draft = computeAnnualPlanUpdate({ targetYear: year, marketData, storage: household, now });
        const state = JSON.parse(draft.records[CONFIG.STORAGE.LS_KEY]);
        state.annualPeriodMetadata.pendingCommit = { periodId: draft.periodId, snapshotId: `qs-f-cash-${year}`, phase: 'writes_started' };
        draft.records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
        const cash = { people: captureCashPeople({ storage: household, activeId: draft.profileId, ids: draft.scope.ids }),
            values: { muster_a: 500000 + (year - 2026) * 10000, muster_b: 200000 + (year - 2026) * 5000 } };
        const committed = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, cash, now });
        const preview = await evaluateAnnualPlanPreview({ targetYear: year, marketData, storage: household, cash, now,
            engineLoader: { load: async () => EngineAPI } });
        if (year > 2026) factor *= 1.1;
        assertEqual(JSON.stringify(preview.adopted), JSON.stringify(committed.receipt.adopted), `QS-F 1+2 ${year}: Vorschau und Beleg bei wechselndem Haushaltscash gleich`);
        assertEqual(committed.result.inputData.tagesgeld, cash.values.muster_a + cash.values.muster_b, `QS-F 1+2 ${year}: Folgeabschluss verwendet neuen gemeinsamen Cashstand`);
        assertClose(committed.result.modelResult.newState.cumulativeInflationFactor, factor, 1e-12, `QS-F 1+2 ${year}: Cashänderung bewahrt fortgeschriebene Kaufkraftbasis`);
        household = annualRecordStorage({ ...household.records, ...committed.records });
    }
}

// 2: Drei Folgeabschlüsse, Wiederholung des Entwurfs und Wechsel des aktiven Mitglieds.
async function finding2() {
    let storage = annualRecordStorage(readyAnnualFixture().records), expectedFactor = 1;
    for (let year = 2026; year <= 2029; year++) {
        const now = () => new Date(`${year + 1}-01-02T12:00:00Z`);
        const marketData = { inflation: { ...annualTestMarketData.inflation, year, rate: 10 },
            etf: { ...annualTestMarketData.etf, targetYear: year, price: 160, date: new Date(`${year}-12-31`), asOf: `${year}-12-31` },
            cape: { ...annualTestMarketData.cape, capeAsOf: `${year}-12-01`, capeUpdatedAt: now().toISOString() } };
        const state = JSON.parse(storage.getItem(CONFIG.STORAGE.LS_KEY));
        state.annualPeriodMetadata ||= { schemaVersion: 1, lastCommittedPeriod: `calendar-year:${year - 1}`, pendingCommit: null };
        state.annualPeriodMetadata.pendingCommit = { periodId: `calendar-year:${year}`, snapshotId: `qs-f-${year}`, phase: 'writes_started' };
        storage.setItem(CONFIG.STORAGE.LS_KEY, JSON.stringify(state));
        const draft = computeAnnualPlanUpdate({ targetYear: year, marketData, storage, now });
        const prepared = prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, now });
        // Die erste Haushaltsrechnung legt ihre reale Ausgangsbasis neu an.
        if (year > 2026) expectedFactor *= 1.1;
        assertClose(prepared.result.modelResult.newState.cumulativeInflationFactor, expectedFactor, 1e-12, `QS-F 2 ${year}: Haushaltsfaktor wächst genau einmal`);
        const repeated = computeAnnualPlanUpdate({ targetYear: year, marketData, storage: annualRecordStorage(draft.records), now });
        assertClose(evaluateAnnualDraft(repeated, { engineApi: EngineAPI, now }).modelResult.newState.cumulativeInflationFactor,
            expectedFactor, 1e-12, `QS-F 2 ${year}: erneuter Entwurf inflationiert nicht doppelt`);
        const registry = JSON.parse(prepared.records.rs_profiles_v1);
        for (const profile of Object.values(registry.profiles)) {
            const saved = JSON.parse(profile.data[CONFIG.STORAGE.LS_KEY]);
            assertClose(saved.profilverbundHouseholdLastState.cumulativeInflationFactor, expectedFactor, 1e-12, `QS-F 2 ${year}: jede Haushaltskopie hat denselben Faktor`);
        }
        if (year > 2026) {
            const calculation = evaluateAnnualDraft(draft, { engineApi: EngineAPI, now });
            const total = ['tagesgeld', 'geldmarktEtf', 'depotwertAlt', 'depotwertNeu', 'goldWert'].reduce((sum, key) => sum + calculation.inputData[key], 0);
            assertClose(calculation.modelResult.diagnosis.keyParams.currentRealVermoegen, total / expectedFactor, 1e-7, `QS-F 2 ${year}: reales Vermögen verwendet den Haushaltsfaktor`);
            assertClose(calculation.modelResult.diagnosis.keyParams.realerDepotDrawdown, 1 - 1 / expectedFactor, 1e-12, `QS-F 2 ${year}: Kaufkraftverlust erscheint im realen Drawdown`);
        }
        const nextId = year % 2 ? 'muster_a' : 'muster_b';
        const nextState = { ...JSON.parse(registry.profiles[nextId].data[CONFIG.STORAGE.LS_KEY]),
            ...Object.fromEntries(HOUSEHOLD_OWNED_BALANCE_STATE_KEYS.filter(key => Object.hasOwn(prepared.state, key)).map(key => [key, prepared.state[key]])) };
        storage = annualRecordStorage({ ...storage.records, ...prepared.records, ...registry.profiles[nextId].data,
            [CONFIG.STORAGE.LS_KEY]: JSON.stringify(nextState), rs_current_profile: nextId, rs_active_profile: nextId });
    }
}

// 3: Schutz in Periodenprüfung, direktem Entwurf und produktivem Abschlussdienst.
async function finding3() {
    const gapSample = readyAnnualFixture(), gapState = JSON.parse(gapSample.records[CONFIG.STORAGE.LS_KEY]);
    gapState.annualPeriodMetadata.lastCommittedPeriod = 'calendar-year:2024';
    gapSample.records[CONFIG.STORAGE.LS_KEY] = JSON.stringify(gapState);
    assertEqual(createAnnualPeriodPlan({ targetYear: 2026, currentAge: 67, metadata: gapState.annualPeriodMetadata }).status, 'invalid', 'QS-F 3: Jahreslücke wird abgewiesen');
    let rejected = false;
    try { computeAnnualPlanUpdate({ targetYear: 2026, marketData: annualTestMarketData, storage: annualRecordStorage(gapSample.records), now: annualTestNow }); } catch (error) { rejected = /2025/.test(error.message); }
    assert(rejected, 'QS-F 3: direkter Entwurf nennt fehlendes Anschlussjahr 2025');
    const service = await annualServiceFixture({ sample: gapSample });
    const beforeGap = JSON.stringify(Object.fromEntries(service.backend));
    const gapResult = await service.create().close({ targetYear: 2026 });
    assertEqual(gapResult.status, 'invalid', 'QS-F 3: Abschlussdienst erlaubt keinen Sprung');
    assertEqual(JSON.stringify(Object.fromEntries(service.backend)), beforeGap, 'QS-F 3: Jahreslücke verändert keine Records');
    assertEqual(service.snapshots.size, 0, 'QS-F 3: Jahreslücke erzeugt keinen Wiederherstellungspunkt');
}

// 4: Ein Jahr Reichweite und kein Geldmarktbestand; dieselbe Quelle in Renderer und Ausführung.
async function finding4() {
    const input = { aktuellesAlter: 67, floorBedarf: 24000, flexBedarf: 0, minimumFlexAnnual: 0,
        tagesgeld: 66000, geldmarktEtf: 0, depotwertAlt: 500000, depotwertNeu: 0,
        costBasisAlt: 500000, costBasisNeu: 0, goldWert: 0, goldAktiv: false,
        renteAktiv: false, inflation: 0, liquidityRunwayYears: 1, minCashBufferMonths: 2, entnahmeStrategie: 'standard',
        endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100, endeVJ_3: 100, ath: 100, jahreSeitAth: 0, dynamicFlex: false };
    const model = EngineAPI.simulateSingleYear(input, null);
    assertEqual(model.ui.spending.monatlicheEntnahme, 2000, 'QS-F 4: Gegenprobe mit 2.000 Euro Monatsentnahme');
    assertEqual(model.ui.action.verwendungen.aktien, 40000, 'QS-F 4: Gegenprobe mit 40.000 Euro Aktienkauf');
    const split = splitPlayLiquidity(input, model.ui.action, model.ui.spending, model.ui.zielLiquiditaet);
    assertEqual(split.fromGeldmarkt, 0, 'QS-F 4: kein Geldmarktverkauf ohne Bestand');
    assertEqual(split.fromTagesgeld, split.totalOutflow, 'QS-F 4: vollständige Finanzierung aus Tagesgeld');
    const renderer = new ActionRenderer({ outputs: {} });
    const projected = renderer._projectTransaction(model.ui.action, input, model.ui.spending, model.ui.zielLiquiditaet);
    assert(!JSON.stringify(projected).includes('"label":"Geldmarkt-ETF"'), 'QS-F 4: angezeigte Quellen enthalten keinen erfundenen Geldmarktverkauf');
    const limited = splitPlayLiquidity({ tagesgeld: 30000, geldmarktEtf: 10000, liquidityCashMonths: 60 }, { quellen: [{ kind: 'liquiditaet', brutto: 20000 }] }, { monatlicheEntnahme: 2000 }, 24000);
    assertEqual(limited.fromGeldmarkt, 10000, 'QS-F 4: Geldmarktquelle bleibt am Bestand begrenzt');
    assertEqual(limited.fromTagesgeld + limited.fromGeldmarkt, 20000, 'QS-F 4: verfügbare Quellen decken weiterhin den Kaufbetrag');
    const seed = readyAnnualFixture('Einzelprofil').records, registry = JSON.parse(seed.rs_profiles_v1), profileId = seed.rs_current_profile;
    const data = registry.profiles[profileId].data;
    data.profile_tagesgeld = '66000'; delete data.profile_cash_history_v1; delete seed.profile_cash_history_v1;
    data.depot_tranchen = JSON.stringify(JSON.parse(data.depot_tranchen).filter(lot => lot.category !== 'money_market'));
    Object.assign(seed, data, { rs_profiles_v1: JSON.stringify(registry) });
    const fixture = await playFixture('localstorage', seed);
    let controller = await fixture.boot();
    await controller.start(async () => ({ source: 'copy', testDate: '2026-11-02' }));
    controller = await fixture.boot();
    const realBefore = fixture.realBytes();
    const booking = await preparePlayAction({ controller, id: 'qs-f-cash-only', entries: [{ profileId, input,
        action: model.ui.action, spending: model.ui.spending, cashSplit: split }] });
    assertEqual(booking.batch.people[0].finalCash, 26000, 'QS-F 4: automatische Eintragung kann den Kauf ohne Geldmarktverkauf vorbereiten');
    assertEqual(booking.lines.filter(line => line.kind === 'sale').length, 0, 'QS-F 4: Eintragung erzeugt keinen Verkauf aus leerem Geldmarkt');
    assertEqual(fixture.realBytes(), realBefore, 'QS-F 4: Spielvorbereitung bewahrt echte Records');
}

// 5: Gültiger Nullwert, vorhandener Altstand und fehlender Parameter bleiben verschieden.
async function finding5() {
    const values = { ...structuredClone(PLAN_DEFAULTS), flexBedarf: 20000, minimumFlexAnnual: 0, flexBudgetAnnual: 7000, flexBudgetYears: 0, flexBudgetRecharge: 0 };
    assertPlanValues(values);
    for (const state of [{}, { flexBudgetBalanceYears: 4 }, { flexBudgetBalance: 4 }]) {
        const result = applyFlexBudgetCap(100, { flex: 20000 }, values, { ...state, keyParams: { wealthReductionFactor: 1 } }, { sKey: 'bear_deep' }, () => {});
        assertEqual(result.balanceYears, 0, 'QS-F 5: null Jahre bleiben auch mit gespeichertem Altstand leer');
        assertEqual(result.rate, 100, 'QS-F 5: leerer Topf wendet keine Krisenkappung an');
    }
    const missing = { ...values }; delete missing.flexBudgetYears;
    assertEqual(applyFlexBudgetCap(100, { flex: 20000 }, missing, {}, { sKey: 'bear_deep' }, () => {}).balanceYears, 4, 'QS-F 5: fehlende Einstellung behält fünf Jahre Vorgabe');
}

const failures = [];
for (const check of [finding1, finding2, finding3, finding4, finding5]) {
    try { await check(); } catch (error) { console.error(check.name, String(error.message).slice(0, 180)); failures.push(error); }
}
if (failures.length) throw failures[0];
