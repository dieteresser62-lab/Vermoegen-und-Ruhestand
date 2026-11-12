// GU-1b (Gutachten Fable zu GU-1, FR-77 Punkt 2): von Hand hergeleitete Sollfälle als dauerhafte Node-Tests.
// Nur synthetische Daten: Beispielhaushalte, erfundene Verkäufe und Personenwerte.
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { EngineAPI } from '../engine/index.mjs';
import { registerPlanTrial } from '../app/shared/plan-trial.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';
import { annualRecordStorage, computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { prepareAnnualCommitRecords } from '../app/balance/balance-annual-storage-commit.js';
import { annualTestMarketData } from './helpers/balance-storage-fixtures.mjs';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { evaluateBalanceFileInputs } from '../app/balance/balance-file-service.js';
import { evaluateStoredAnnualHousehold } from '../app/balance/balance-main-profilverbund.js';
import { createBalanceDisplayEngineApi, buildBalanceRendererPayload } from '../app/balance/balance-update-pipeline.js';
import { projectNextYearBudget } from '../app/balance/balance-next-year-budget.js';
import { projectBalanceFlexTrace } from '../app/balance/balance-flex-trace.js';
import { UIRenderer, initUIRenderer } from '../app/balance/balance-renderer.js';
import { ActionRenderer } from '../app/balance/balance-renderer-action.js';
import { currentYearActionSource, projectBalanceReserves } from '../app/balance/balance-reserves.js';
import { projectAnnualActionProgress, remainingAnnualAction, withAnnualActionProgress, ANNUAL_ACTION_DONE_SHARE } from '../app/balance/annual-action-progress.js';
import { summarizeBalanceAction, describeBalanceActionSummary } from '../app/balance/balance-action-summary.js';
import { projectOverviewFromRecords } from '../app/overview/overview-model.js';
import { projectBalanceActionOrigin } from '../app/balance/balance-action-origin.js';
import { sourceFingerprint } from '../app/overview/overview-simulation-summary.js';
import { overviewScope } from '../app/overview/overview-storage.js';
import { formatAnnualNeed } from '../app/balance/balance-annual-preview.js';
import { createAnnualPlanResult } from '../app/shared/annual-close-result.js';
import { dialogElements } from '../app/shared/close-dialog.js';
import { createDialogFixture } from './close-dialog.test.mjs?fixture';
import { measurementInputs, backtest } from './helpers/ek-1b-measurement.mjs';

const DATE = '2026-10-23', clean = text => String(text).replaceAll(' ', ' ').replaceAll(' ', ' ');

async function freshArea(records) {
    P.resetPersistenceForTests({ name: 'gu-1b-synthetic', loadAll: async () => ({ ...records }),
        async saveBatch(batch) { batch.deletes.forEach(key => delete records[key]); batch.upserts.forEach(([key, value]) => { records[key] = value; }); },
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}

/** Bestätigte Verkäufe wie nach „Verkauf eintragen“: Stücke weniger, Nettoerlös aufs Tagesgeld, Verkaufsbeleg in der Registry. */
function withSales(records, sales) {
    const registry = JSON.parse(records.rs_profiles_v1), actions = [];
    for (const [index, sale] of sales.entries()) {
        const data = registry.profiles[sale.profileId].data, active = records.rs_current_profile === sale.profileId;
        const cash = Number(data.profile_tagesgeld) + (sale.pending ? 0 : sale.net);
        data.profile_tagesgeld = String(cash);
        const tranches = JSON.parse(data.depot_tranchen), lot = tranches.find(item => item.trancheId === sale.trancheId);
        const sold = sale.net / lot.currentPrice, before = lot.shares;
        lot.shares = before - sold; data.depot_tranchen = JSON.stringify(tranches);
        if (active) { records.profile_tagesgeld = data.profile_tagesgeld; records.depot_tranchen = data.depot_tranchen; }
        actions.push({ schemaVersion: 1, eventType: 'sale_reconciled', actionId: `gu1b-sale-${index}`, profileId: sale.profileId, trancheId: sale.trancheId,
            executedAt: sale.executedAt, actual: { sharesSold: sold, grossProceeds: sale.net, fees: 0, taxes: 0, netProceeds: sale.net },
            ...(sale.pending ? { cashStatus: 'pending_manual_posting' } : { cashStatus: 'confirmed_already_reflected', cashBalanceAfterPostingEur: cash,
                cashConfirmedAt: `${sale.executedAt}T10:00:00.000Z` }),
            result: { beforeShares: before, remainingShares: lot.shares, trancheRemoved: false }, reconciledAt: `${sale.executedAt}T10:00:00.000Z` });
    }
    registry.trancheReconciliation = { schemaVersion: 1, actions };
    records.rs_profiles_v1 = JSON.stringify(registry);
    return records;
}

function evaluate(records, date) {
    setAppTestDate(date);
    const storage = annualRecordStorage(records), api = createBalanceDisplayEngineApi(EngineAPI);
    const calculation = buildBalanceEngineInputFromStorage({ storage }), plan = calculation.householdPlan;
    const evaluation = evaluateBalanceFileInputs({ inputData: calculation.inputData, persistentState: calculation.history.persistentState,
        profiles: calculation.history.profiles, profileId: records.rs_current_profile, engineApi: api, publish: false,
        planInputs: plan.entry.values, marketPreviewContext: { calculation, storage },
        profilverbundHandlers: { runProfilverbundProfileSimulations: (input, profiles, state) => evaluateStoredAnnualHousehold(input, profiles, state,
            { engineApi: api, publish: false, withdrawalMode: plan.entry.values.householdWithdrawalMode }) } });
    const entriesOf = runs => runs?.map(run => ({ profileId: run.profileId, name: run.name, action: run.ui.action, input: run.input,
        spending: run.ui.spending, targetLiquidity: run.ui.zielLiquiditaet })) || null;
    const current = { ...buildBalanceRendererPayload(evaluation.modelResult, evaluation.previewInputData || calculation.inputData),
        profileActionResults: entriesOf(evaluation.profilverbundRuns) };
    return { storage, api, current, entriesOf };
}

/** Max und Erika am 23.10.2026: lesender Weg und dieselbe Karte über den echten Balance-Renderer. */
async function maxErika(sales = [], { trial = false } = {}) {
    const records = withSales(createMusterHaushaltRecords(DATE, 'max-erika'), sales);
    await freshArea({ ...records });
    const { storage, api, current, entriesOf } = evaluate(records, DATE);
    const model = projectOverviewFromRecords({ registry: JSON.parse(records.rs_profiles_v1), activeId: records.rs_current_profile, liveData: records, now: new Date(`${DATE}T12:00:00`) });
    const origin = withAnnualActionProgress(projectBalanceActionOrigin({ comparison: model.planComparison, year: 2026, scope: model.scope, occasion: model.occasion }),
        () => JSON.parse(records.rs_profiles_v1), model.scope.ids);
    const source = currentYearActionSource(current, origin.confirmed);
    const entries = new ActionRenderer({}).prepareExecutionEntries(source.entries, current.zielLiquiditaet);
    const view = projectBalanceReserves(current, entries, { targetEntries: source.targetEntries, settled: source.settled });
    const diagnosis = describeBalanceActionSummary(summarizeBalanceAction(source.action, source.action, entries), value => `${Math.round(value).toLocaleString('de-DE')} €`);
    const next = projectNextYearBudget({ storage, engineApi: api, now: () => new Date(`${DATE}T12:00:00`) });
    const projected = next.displayEvaluation;
    const doc = new MockDocument(), saved = { document: globalThis.document, window: globalThis.window };
    globalThis.document = doc; globalThis.window = { document: doc };
    if (trial) registerPlanTrial(doc, { read: () => ({ active: true }), values: () => ({}) });
    let card;
    try {
        const outputs = new Proxy({}, { get: (_, key) => typeof key === 'string' ? doc.getElementById(key) : undefined, has: () => true });
        initUIRenderer({ outputs, inputs: {}, containers: {} }, { loadState: () => ({}) });
        UIRenderer.render({ ...buildBalanceRendererPayload(projected.modelResult, { ...projected.inputData, referenceYear: next.targetYear }), nextYearBudget: next,
            currentYear: current, profileActionResults: entriesOf(projected.profilverbundRuns) });
        const text = id => clean(doc.getElementById(id).textContent);
        card = { values: text('balanceReserveValues'), targets: text('balancePersonalCashTargets'), cut: text('balanceBudgetCut') };
    } finally { Object.assign(globalThis, saved); }
    P.resetPersistenceForTests(); setAppTestDate(null);
    return { origin, progress: origin.confirmed?.progress, view, diagnosis, card, current, projected, next };
}

// Teil A: Belegaktion 89.312,50 € netto (Beleg: Max 9.362,92 €, Erika 79.949,58 €), Ziel Liquidität 162.000 €.
const MAX = { profileId: 'muster_a', trancheId: 'muster_a_lot_2', net: 9362.50, executedAt: '2026-02-10' };
const ERIKA = { profileId: 'muster_b', trancheId: 'muster_b_lot_2', net: 79950, executedAt: '2026-02-10' };
{
    const a1 = await maxErika();
    assertEqual(a1.view.target, 162000, 'A1: Ziel Liquidität 162.000 €');
    assertEqual(a1.progress.status, 'offen', 'A1: Nicht umgesetzt, Plan offen');
    assertEqual(a1.view.before.liquidity, 90000, 'A1: heute 90.000 €');
    assertClose(a1.view.after.liquidity, 179312.50, 0.01, 'A1: nach Umsetzung 179.312,50 €');
    assert(a1.card.values.includes('nach Umsetzung179.312 €'), 'A1: Reservekarte zeigt 179.312 € nach Umsetzung');
    assert(a1.diagnosis.includes('89.312 € netto'), 'A1: Diagnose nennt den ganzen Beleg, 89.312 € netto');
    // A4: Die persönlichen Tagesgeldziele kommen aus den Personeneinträgen des laufenden Jahres.
    assertEqual(a1.view.targets.map(row => `${row.name} ${row.target}`).join(' · '), 'Max 5000 · Erika 27400', 'A4: Tagesgeldziele Max 5.000 € und Erika 27.400 €');
    assertEqual(a1.card.targets, 'Tagesgeldziel: Max 5.000 € · Erika 27.400 € · Summe 32.400 €', 'A4: Die Zeile mit den persönlichen Tagesgeldzielen steht wieder da');

    const a2 = await maxErika([MAX, ERIKA]);
    assertEqual(a2.progress.status, 'erledigt', 'A2: Beide Zeilen erledigt');
    assertEqual(a2.progress.restNet, 0, 'A2: Offener Rest 0 €');
    assertClose(a2.view.before.liquidity, 179312.50, 0.01, 'A2: heute 179.312,50 €');
    assertClose(a2.view.after.liquidity, 179312.50, 0.01, 'A2: nach Umsetzung 179.312,50 €, nicht 268.625 €');
    assert(a2.card.values.includes('nach Umsetzung179.313 €') && !a2.card.values.includes('268.625'), 'A2: Reservekarte zählt den Erlös nicht doppelt');
    assert(!a2.diagnosis.includes('netto'), 'A2: Diagnose nennt keinen offenen Verkauf mehr');
    assertEqual(a2.card.targets, 'Tagesgeldziel: Max 5.000 € · Erika 27.400 € · Summe 32.400 €', 'A4: Tagesgeldziele auch nach der Umsetzung');

    // Max hat seine Zeile verkauft (9.362,50 € von 9.362,92 €, über 98 %); offen bleibt Erikas Zeile.
    const a3 = await maxErika([MAX]);
    assertEqual(a3.progress.lines.map(line => line.status).join(' · '), 'erledigt · offen', 'A3: Max erledigt, Erika offen');
    assertEqual(a3.progress.status, 'teilweise', 'A3: Plan teilweise umgesetzt');
    assertClose(a3.view.before.liquidity, 99362.50, 0.01, 'A3: heute 99.362,50 €');
    assertClose(a3.progress.restNet, 79950, 0.5, 'A3: offener Rest 79.950 €');
    assertClose(a3.view.after.liquidity, 179312.50, 0.5, 'A3: nach Umsetzung 179.312,50 € (Beleg-Cent von Max fällt unter die 98-%-Regel)');
    assert(a3.card.values.includes('nach Umsetzung179.312 €'), 'A3: Reservekarte zeigt 179.312 € nach Umsetzung');
    assert(a3.diagnosis.includes('79.950 € netto'), 'A3: Diagnose nennt den offenen Rest 79.950 € netto');

    // Planversuch: Die Karte rechnet wie vor GU-1 mit der Neuberechnung (89.185,46 € netto zu heutigen Kursen).
    const trial = await maxErika([], { trial: true });
    assert(trial.card.values.includes('nach Umsetzung179.185 €'), 'A: Im Planversuch rechnet die Karte mit der Neuberechnung, nicht mit dem Beleg');
}

// FR-77 Punkt 2 an der reinen Funktion: Person und Anlageklasse, Beschlusstag, Planjahr, 98 %, Gutschrift offen.
{
    const action = { quellen: [{ kind: 'aktien_neu', category: 'equity', sourceProfileId: 'a', brutto: 10500, steuer: 500, netto: 10000 },
        { kind: 'gold', category: 'gold', sourceProfileId: 'a', brutto: 4000, steuer: 0, netto: 4000 },
        { kind: 'aktien_alt', category: 'equity', sourceProfileId: 'b', brutto: 6000, steuer: 0, netto: 6000 },
        { kind: 'liquiditaet', brutto: 1000, netto: 1000, steuer: 0, internalCashRebalance: true }],
        verwendungen: { liquiditaet: 20000, gold: 0 }, nettoErlös: 20000, steuer: 500, bruttoVerkaufGesamt: 20500 };
    const sale = (profileId, assetClass, netProceeds, executedAt = '2026-03-01', creditPending = false) => ({ profileId, trancheId: 'x', executedAt, netProceeds, assetClass, creditPending });
    const progress = sales => projectAnnualActionProgress({ action, year: 2026, decidedOn: '2026-01-05', sales });
    assertEqual(ANNUAL_ACTION_DONE_SHARE, 0.98, 'FR-77: Ab 98 % gilt eine Zeile als erledigt');
    assertEqual(progress([]).lines.length, 3, 'FR-77: Drei Planzeilen, die interne Umschichtung ist keine');
    const partial = progress([sale('a', 'equity', 4000), sale('b', 'gold', 6000), sale('a', 'equity', 3000, '2026-01-04'), sale('a', 'equity', 3000, '2025-12-30')]);
    assertEqual(partial.lines.map(line => line.status).join(' · '), 'teilweise · offen · offen', 'FR-77: Nur dieselbe Person, Anlageklasse, ab Beschluss und im Planjahr');
    assertEqual(partial.lines[0].restNet, 6000, 'FR-77: Rest = Plan − verkauft');
    const done = progress([sale('a', 'equity', 9800, '2026-01-05', true), sale('a', 'gold', 3919.99), sale('b', 'equity', 7000)]);
    assertEqual(done.lines.map(line => line.status).join(' · '), 'erledigt · teilweise · erledigt', 'FR-77: 98 % genau erledigt, knapp darunter teilweise');
    assertEqual(done.lines[0].creditPendingNet, 9800, 'FR-77: Verkauf ohne Gutschrift bleibt für „Gutschrift nachtragen“ erkennbar');
    assertClose(done.restNet, 80.01, 1e-9, 'FR-77: Offener Rest nur aus der Goldzeile');
    const rest = remainingAnnualAction(action, partial);
    assertEqual(rest.quellen.map(source => source.netto).join(' · '), '6000 · 4000 · 6000 · 1000', 'Offener Rest: Quellen anteilig, interne Umschichtung unverändert');
    assertEqual(rest.quellen[0].steuer, 300, 'Offener Rest: Steuer der Zeile anteilig');
    assertEqual(rest.nettoErlös, 16000, 'Offener Rest: Nettoerlös ohne den verkauften Teil');
    assertEqual(rest.verwendungen.liquiditaet, 16000, 'Offener Rest: Verwendungen im Verhältnis offener Rest zu Plan');
    assertEqual(remainingAnnualAction(action, progress([])), action, 'Ohne Verkauf bleibt die Belegaktion unverändert');
    assertEqual(action.quellen[0].netto, 10000, 'Der Beleg selbst wird nicht verändert');
    const none = { type: 'NONE', title: 'Keine Transaktion' };
    assertEqual(currentYearActionSource({ input: {} }, { action: none, progress: projectAnnualActionProgress({ action: none, year: 2026 }) }).settled, false,
        'Ein Beleg ohne Verkauf gilt nicht als umgesetzt; die Karte zeigt dann wie bisher nur heute');
}

// Teil B: Rundung ist nie eine Kürzung; eine echte Kürzung nennt den vollen Unterschied zum Plan.
{
    const b1 = await maxErika();
    assertEqual(projectBalanceFlexTrace(b1.current).cut, 0, 'B1: Max und Erika 23.10.2026, laufendes Jahr ohne Warnung');
    const projectedUi = { ...b1.projected.modelResult.ui, input: b1.projected.inputData };
    assertEqual(projectBalanceFlexTrace(projectedUi).cut, 0, 'B1: Folgejahr ohne Projektionsbezug ohne Warnung');
    assertEqual(projectBalanceFlexTrace({ ...projectedUi, nextYearBudget: b1.next }).cut, 0, 'B1: Folgejahr mit Projektion ohne Warnung');
    assertEqual(b1.card.cut, 'Dein Haushalts-Flex ist voll finanziert.', 'B1: Budgetkarte ohne Kürzungswarnung');

    // B2: Abschluss 2026 gebucht (Plan danach 31.000 € + 31.000 €), Budgetkarte 2027 ohne Projektion.
    const records = createMusterHaushaltRecords('2026-12-15', 'max-erika');
    const key = 'ruhestandsmodellValues_v29_guardrails', state = JSON.parse(records[key]);
    state.annualPeriodMetadata.pendingCommit = { periodId: 'calendar-year:2026', snapshotId: 'gu1b-before', phase: 'writes_started' };
    records[key] = JSON.stringify(state);
    setAppTestDate('2026-12-15');
    const now = () => new Date('2027-01-02T12:00:00Z');
    const draft = computeAnnualPlanUpdate({ targetYear: 2026, marketData: annualTestMarketData, storage: annualRecordStorage(records), now });
    const booked = { ...records, ...prepareAnnualCommitRecords(draft, { engineApi: EngineAPI, now }).records };
    const plan = Object.values(JSON.parse(booked.household_plan_v1).entries)[0].values;
    assertEqual(`${plan.floorBedarf} + ${plan.flexBedarf}`, '31000 + 31000', 'B2: Gebuchter Plan 31.000 € + 31.000 €');
    const b2 = projectBalanceFlexTrace(evaluate(booked, '2027-01-02').current);
    assertClose(b2.budget, 5100, 1e-9, 'B2: Budget 5.100 € gegen Bedarf 5.166,67 €');
    assertEqual(b2.cut, 0, 'B2: Nach gebuchtem Jahresabschluss keine Warnung');
    assertEqual(b2.householdFlexRate, 100, 'B2: Haushalts-Flex gilt als voll finanziert');
    setAppTestDate(null);

    // B3: eigener Bedarf 61.500 € ohne Planrundung, Einkünfte 3.100 €/Monat, Entnahme 2.025 € → 2.000 €.
    const step = (schritt, vorher, nachher) => ({ schritt, monatsbetragVorher: vorher, monatsbetragNachher: nachher, monatswirkungEur: nachher - vorher, gegriffen: nachher !== vorher });
    const own = trace => ({ input: { floorBedarf: 36000, flexBedarf: 25500, renteAktiv: true, renteMonatlich: 3100 }, spending: { monatlicheEntnahme: trace.at(-1).monatsbetragNachher, flexTrace: trace } });
    const b3 = projectBalanceFlexTrace(own([step('quantization', 2025, 2000)]));
    assertEqual(`${b3.grossNeed} / ${b3.budget}`, '5125 / 5100', 'B3: Bedarf 5.125 € und Budget 5.100 € im Monat');
    assertEqual(b3.cut, 0, 'B3: Abrundung der Auszahlung ist keine Kürzung');
    const real = projectBalanceFlexTrace(own([step('guardrails', 2025, 1925), step('quantization', 1925, 1900)]));
    assertEqual(real.cut, 125, 'B3: Greift ein anderer Schritt, nennt die Warnung den vollen Unterschied zum Plan');

    // B4: Renate rechnet im Folgejahr mit S-Kurve, Leitplanken und Glättung: echte Kürzung, voller Unterschied 166,67 €.
    const renateRecords = createMusterHaushaltRecords(DATE, 'renate');
    await freshArea({ ...renateRecords });
    const renate = evaluate(renateRecords, DATE);
    const renateNext = projectNextYearBudget({ storage: renate.storage, engineApi: renate.api, now: () => new Date(`${DATE}T12:00:00`) });
    const renateUi = { ...renateNext.displayEvaluation.modelResult.ui, input: renateNext.displayEvaluation.inputData, nextYearBudget: renateNext };
    const renateTrace = projectBalanceFlexTrace(renateUi);
    assert(renateUi.spending.flexTrace.some(entry => entry.gegriffen && entry.schritt !== 'quantization'), 'B4: Bei Renate greifen Schritte außer der Rundung');
    assertClose(renateTrace.cut, 3166.67 - 3000, 0.01, 'B4: Renate meldet den vollen Unterschied zum Plan, 167 € weniger');
    assertClose(renateTrace.householdFlexRate, 84.615, 0.001, 'B4: Renate 84,6 % finanziert wie vor GU-1');
    P.resetPersistenceForTests(); setAppTestDate(null);
}

// Teil C: Fingerprint der Übersicht liest den fehlenden Wert als Vorgabe.
{
    const records = createMusterHaushaltRecords(DATE, 'max-erika'), registry = JSON.parse(records.rs_profiles_v1);
    const scope = overviewScope('household', Object.keys(registry.profiles));
    const fingerprint = (extra = {}) => {
        const copy = structuredClone(registry);
        for (const profile of Object.values(copy.profiles)) Object.assign(profile.data, extra);
        return sourceFingerprint({ registry: copy, activeId: records.rs_current_profile, liveData: { ...records, ...extra }, scope, kind: 'montecarlo' });
    };
    // Gemessen auf 855e3988 (vor GU-1b), synthetischer Haushalt ohne gespeicherten Wert.
    const beforeGu1b = '4d7e39badb0aeb2bcad3990f1e795abb0cc10a305f17dccfcc67b70eabd8c493';
    assertEqual(fingerprint(), fingerprint({ sim_equityCostPct: '0.5' }), 'C1: Ohne Schlüssel gleich „0.5“');
    assert(fingerprint() !== beforeGu1b, 'C1: Ohne Schlüssel anders als vor GU-1b, alte Ergebnisse gelten einmal als veraltet');
    // KO-2: Die Fondskosten sind ein Planwert; ein eigener Wert ändert den Fingerprint über den Plan (tests/ko-2-sollfaelle.test.mjs, S4).
    assertEqual(fingerprint({ sim_equityCostPct: '0' }), fingerprint(), 'C1 (KO-2): Der frühere Simulator-Schlüssel zählt nicht mehr');
    assertEqual(sourceFingerprint({ registry, activeId: records.rs_current_profile, liveData: records, scope, kind: 'balance' }),
        '0600bf94b702d218f7ad5970eb3ba965d3999674733d6c5945a8db659648f544', 'C1: Balance-Fingerprint bleibt bytegleich');
}

// Teil E: Depot im ersten Jahr mit je einer Aktien-, Anleihe- und Goldtranche; Belegtext der Aufrundung.
{
    const inputs = await measurementInputs(0, 'renate', '2026-10-28');
    const base = inputs.detailledTranches[0];
    const lot = (id, type, category, value) => ({ ...base, trancheId: `muster_renate:gu1b_${id}`, name: `Synthetisch ${id}`, type, category,
        ticker: undefined, isin: undefined, instrumentId: undefined, marketValue: value, shares: value / 100, currentPrice: 100, purchasePrice: 90,
        costBasis: value * 0.9, tqf: category === 'equity' ? 0.3 : 0 });
    const tranches = [lot('aktie', 'aktien_neu', 'equity', 100000), lot('anleihe', 'anleihe', 'bonds', 50000), lot('gold', 'gold', 'gold', 30000)];
    const afterReturns = k => backtest({ ...inputs, equityCostPct: k, detailledTranches: structuredClone(tranches) }, 2000, 2000)
        .rows[0].row.balance_trace.find(entry => entry.phase === 'after_returns');
    const gross = afterReturns(0), net = afterReturns(0.5);
    assert(gross.equity > 0 && gross.bonds > 0 && gross.gold > 0, 'E: Je eine Aktien-, Anleihe- und Goldtranche im ersten Jahr');
    assertClose(net.equity, gross.equity * (1 - 0.005), 1e-6, 'E: Aktien im ersten Jahr = Depot ohne Kosten × (1 − k), genau einmal');
    assertEqual(net.bonds, gross.bonds, 'E: Anleihe ohne Fondskosten');
    assertEqual(net.gold, gross.gold, 'E: Gold ohne Fondskosten');
    P.resetPersistenceForTests(); setAppTestDate(null);

    const options = { inflation: { rate: 2.5 }, targetYear: 2026 };
    assert(clean(formatAnnualNeed({ id: 'floorBedarf', before: 30000, after: 31000 }, options)).endsWith('(+2,5 % Inflation 2026, aufgerundet auf volle 1.000 €)'),
        'E: Herleitung nennt die Aufrundung 30.750 € → 31.000 €');
    assert(!formatAnnualNeed({ id: 'floorBedarf', before: 40000, after: 41000 }, options).includes('aufgerundet'), 'E: Ohne Rundung (40.000 € × 1,025) kein Zusatz');
    const tile = needs => {
        const { doc } = createDialogFixture();
        const section = createAnnualPlanResult({ doc, result: { year: 2027, targetYear: 2026, inflation: { rate: 2.5 }, needs },
            model: { summary: { monthlyBudget: 5000 }, annual: {} } });
        return dialogElements(section).map(node => clean(node.textContent || '')).join(' ');
    };
    assert(tile([{ id: 'floorBedarf', before: 30000, after: 31000 }, { id: 'flexBedarf', before: 30000, after: 31000 }]).includes('+2,50 % Inflation 2026 · aufgerundet auf volle 1.000 €'),
        'E: Abschlussbeleg „Bedarf 2027“ mit Rundung nennt die Aufrundung');
    assert(!tile([{ id: 'floorBedarf', before: 40000, after: 41000 }, { id: 'flexBedarf', before: 20000, after: 20500 }]).includes('aufgerundet'),
        'E: Abschlussbeleg ohne Rundung ohne Zusatz');
}
