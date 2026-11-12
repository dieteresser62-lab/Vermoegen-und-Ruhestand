import { readLE1References } from './helpers/le-1-expectations.mjs';
// GU-1 (Gutachten 11.11.2026, FR-74, FR-76, S5–S7): von Hand hergeleitete Sollfälle als dauerhafte Node-Tests.
// Nur synthetische Daten: Beispielhaushalte und erfundene Personenwerte.
import { createHash } from 'node:crypto';
import { computeRentAdjRate } from '../app/shared/income-adjustment.js';
import * as yearPortfolio from '../app/simulator/simulator-year-portfolio.js';
import { loadProfileAssetValues, applyProfileAssetValuesToDom, PERSON_FORM_IDS } from '../app/profile/profile-asset-values.js';
import { projectPerson } from '../app/profile/profile-person-data.js';
import { PersistenceFacade as P } from '../app/shared/persistence-facade.js';
import { applyProfileManagementAction } from '../app/profile/profile-manager-bindings.js';
import { MUSTER_HAUSHALTE } from '../app/demo/muster-haushalte.js';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { measurementInputs, parameters, backtest } from './helpers/ek-1b-measurement.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { runMonteCarloChunk } from '../app/simulator/monte-carlo-runner.js';
import { annualData } from '../app/simulator/simulator-data.js';
import { withPreviousRunEvidence } from './helpers/le-1b-expectations.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const memory = data => ({ getItem: key => data[key] ?? null });

// S1 Rentenanpassung „wie Inflation“ (FR-74, Rechnung FR-18 unverändert).
assertEqual(1000 * (1 + computeRentAdjRate({ rentAdjMode: 'cpi' }, { inflation: 3, lohn: 5 }) / 100), 1030, 'S1: Inflation 3 % → Rente 1.000 € wird 1.030 €');
assertEqual(1000 * (1 + computeRentAdjRate({ rentAdjMode: 'cpi' }, { inflation: -1, lohn: 5 }) / 100), 1000, 'S1: Inflation −1 % → Rente bleibt 1.000 € (FR-18)');

async function freshArea(records = {}) {
    P.resetPersistenceForTests({ name: 'gu-1-synthetic', loadAll: async () => ({ ...records }),
        async saveBatch(batch) { batch.deletes.forEach(key => delete records[key]); batch.upserts.forEach(([key, value]) => { records[key] = value; }); },
        writeSnapshot: async () => {}, readSnapshot: async () => null, listSnapshots: async () => [], deleteSnapshot: async () => true });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
}
{
    await freshArea();
    applyProfileManagementAction({ kind: 'create', name: 'Synthetisch Neu' });
    assertEqual(loadProfileAssetValues().rentenanpassungArt, 'cpi', 'S1: Erste neue Person startet mit „wie Inflation“');
    applyProfileManagementAction({ kind: 'create', name: 'Synthetisch Zweit' });
    assertEqual(loadProfileAssetValues().rentenanpassungArt, 'cpi', 'S1: Weitere neue Person startet mit „wie Inflation“');
    P.resetPersistenceForTests();
}
const stored = { profile_person_schema_version: '1', profile_geburtsdatum: '1960-05-01', profile_rentenbeginn: '2027-06-01', profile_rente_monatlich: '1000' };
assertEqual(loadProfileAssetValues(memory({ ...stored, profile_rentenanpassung_art: 'wage' })).rentenanpassungArt, 'wage', 'S1: Gespeichertes „wie Löhne“ bleibt im Formular');
assertEqual(projectPerson({ ...stored, profile_rentenanpassung_art: 'wage' }, 2026).rentAdjMode, 'wage', 'S1: Gespeichertes „wie Löhne“ rechnet weiter mit Löhnen');
assertEqual(loadProfileAssetValues(memory(stored)).rentenanpassungArt, 'wage', 'S1: Person ohne gespeicherten Wert behält im Formular „wie Löhne“ wie bisher');
assertEqual(projectPerson(stored, 2026).rentAdjMode, 'wage', 'S1: Person ohne gespeicherten Wert rechnet wie auf b1ef8ff6');
assertEqual(loadProfileAssetValues(memory({ profile_person_schema_version: '1', profile_aktuelles_alter: '66' })).rentenanpassungArt, 'wage',
    'S1: Altalter ohne gespeicherten Wert bleibt bei „wie Löhne“');
for (const { id } of MUSTER_HAUSHALTE) {
    const profiles = Object.values(JSON.parse(createMusterHaushaltRecords('2026-10-23', id).rs_profiles_v1).profiles);
    assert(profiles.every(profile => profile.data.profile_rentenanpassung_art === 'cpi'), `S1: Beispielhaushalt ${id} rechnet „wie Inflation“`);
}
{
    const { createSelectionDocument, addField } = await import('./designsystem-selection-dom.mjs');
    const { bindManagerProfileControls, syncManagerProfileControls } = await import('../app/tranches/tranchen-manager-profiles.js');
    const doc = createSelectionDocument();
    doc.querySelector = () => null;
    for (const id of ['profilePensionAdjustment', 'profilePensionSegments', 'profileChurchSegments', 'profilePensionWageHint']) {
        const host = doc.body.appendChild(doc.createElement(id === 'profilePensionWageHint' ? 'p' : 'div')); host.id = id;
    }
    for (const [field, id] of Object.entries(PERSON_FORM_IDS)) addField(doc, id, '', field === 'rentenanpassungArt' ? [['wage', 'Lohnentwicklung'], ['cpi', 'Inflation'], ['fix', 'Fester Satz']] : null);
    applyProfileAssetValuesToDom(loadProfileAssetValues(memory({ profile_person_schema_version: '1' })), doc);
    bindManagerProfileControls(doc); syncManagerProfileControls(doc);
    const pension = doc.getElementById('profilePensionSegments'), hint = doc.getElementById('profilePensionWageHint');
    assertEqual(pension.children.map(button => button.textContent).join(' | '), 'wie Inflation | wie Löhne | fester Satz | keine', 'S1: Reihenfolge der Knöpfe');
    assertEqual(pension.children.find(button => button.getAttribute('aria-pressed') === 'true')?.dataset.value, 'cpi', 'S1: Neue Person zeigt „wie Inflation“ gewählt');
    assert(hint.hidden, 'S1: Hinweis bei „wie Inflation“ verborgen');
    const wage = pension.children.find(button => button.dataset.value === 'wage');
    wage.closest = () => wage;
    pension.dispatchEvent({ type: 'click', target: wage });
    assertEqual(doc.getElementById('profileRentenanpassungArt').value, 'wage', 'S1: „wie Löhne“ bleibt wählbar');
    assert(!hint.hidden, 'S1: Hinweis erscheint bei „wie Löhne“');
    doc.getElementById('profilePensionAdjustment').hidden = true; syncManagerProfileControls(doc);
    assert(hint.hidden, 'S1: Bei übernommener Anpassung kein Hinweis unter fremder Wahl');
}

// S2 Fondskosten (FR-76): eine Stelle, (1 + r) × (1 − k) − 1; Gold und Geldmarkt ohne Kosten.
const rates = (rendite, k) => yearPortfolio.readYearReturnRates({ rendite, gold_eur_perf: 4, zinssatz: 2 }, k);
assertClose(rates(0.10, 0.4).rA, 0.0956, 1e-12, 'S2: r = 10 %, k = 0,4 % → 9,56 %');
assertClose(rates(-0.20, 0.4).rA, -0.2032, 1e-12, 'S2: r = −20 %, k = 0,4 % → −20,32 %');
assertEqual(rates(0.10, 0.4).rG, 0.04, 'S2: Gold bleibt ohne Fondskosten');
assertEqual(rates(0.10, 0.4).rC, 0.02, 'S2: Geldmarkt bleibt ohne Fondskosten');
assert(Object.is(rates(0.1, 0).rA, 0.1) && Object.is(rates(-0.2, 0).rA, -0.2), 'S2: k = 0 lässt die Jahresrendite bitgleich');
// Bezug b1ef8ff6: dieselben Eingaben ohne Fondskosten und mit gespeichertem „wie Löhne“ (synthetische Beispielhaushalte, 28.10.2026).
const BASE = {
    'max-erika': { mc: '8ded79e9f82645b2697ab3c07ac0acd11b8cce887842cd7d62533af4c49fd140', backtest: 'cb55c4cfa1a414086ed5caa7973315f80da6f33466d2c081b55c55d7d9c91a9a' },
    renate: { mc: '66f3938a9ae095c5ed269e9a929d8799e0d1f8da317fa9fbbc796d9f7cab1047', backtest: '87eacc461c908aaa5794f95ec0421e54358ff84a5f02b9e893274dc78f3f309f' }
};
for (const id of Object.keys(BASE)) {
    const current = await measurementInputs(0, id, '2026-10-28');
    assertEqual(current.equityCostPct, yearPortfolio.DEFAULT_EQUITY_COST_PCT ?? 0.5, `S2: ${id} liest die Vorgabe aus dem leeren Speicher`);
    const run = async inputs => {
        const mc = await runMonteCarloChunk({ inputs, engine: EngineAPI, monteCarloParams: { ...parameters, anzahl: 40 }, widowOptions: inputs.widowOptions,
            useCapeSampling: false, runRange: { start: 0, count: 40 }, logIndices: Array.from({ length: 40 }, (_, i) => i) });
        const historical = JSON.parse(JSON.stringify(backtest(inputs)));
        // Die Rückgabe spiegelt die Eingaben; nur das neue Feld selbst bleibt beim Vergleich außen vor.
        delete historical.request?.inputs?.equityCostPct;
        return { mc, historical };
    };
    const zero = await run({ ...current, equityCostPct: 0, rentAdjMode: 'wage', renteIndexierungsart: 'wage' });
    assertEqual(hash(withPreviousRunEvidence(zero.mc)), readLE1References(BASE[id].mc), `S2: ${id} Monte Carlo mit k = 0 bytegleich zu b1ef8ff6 (Laufbeleg der Sterbetafel wie vor LE-1b)`);
    assertEqual(hash(zero.historical), readLE1References(BASE[id].backtest), `S2: ${id} Backtest mit k = 0 bytegleich zu b1ef8ff6`);
    if (id === 'renate') {
        const withCost = await run({ ...current, rentAdjMode: 'wage', renteIndexierungsart: 'wage' });
        const row = withCost.historical.rows.find(item => item.jahr === 2000);
        const market = annualData.find(item => item.jahr === 2000).rendite;
        assert(hash(withCost.mc) !== BASE[id].mc, 'S2: Die Vorgabe ändert das Monte-Carlo-Ergebnis');
        assertClose(row.row.NominalReturnEquityPct, (1 + market) * (1 - current.equityCostPct / 100) - 1, 1e-12, 'S2: Backtest-Protokoll 2000 zeigt die Aktienrendite nach Kosten');
        assertClose(zero.historical.rows.find(item => item.jahr === 2000).row.NominalReturnEquityPct, market, 1e-12, 'S2: Ohne Kosten die Marktrendite');
    }
}
P.resetPersistenceForTests(); setAppTestDate(null);

// S3 und S4: Spielbereich „Max und Erika“ am 23.10.2026 (Balance → Dein Monatsbudget, Deine Reserven).
{
    const { MockDocument } = await import('./helpers/balance-page-fixture.mjs');
    const { annualRecordStorage } = await import('../app/balance/balance-annual-storage.js');
    const { projectNextYearBudget } = await import('../app/balance/balance-next-year-budget.js');
    const { buildBalanceEngineInputFromStorage } = await import('../app/balance/balance-input-storage.js');
    const { evaluateBalanceFileInputs } = await import('../app/balance/balance-file-service.js');
    const { evaluateStoredAnnualHousehold } = await import('../app/balance/balance-main-profilverbund.js');
    const { createBalanceDisplayEngineApi, buildBalanceRendererPayload } = await import('../app/balance/balance-update-pipeline.js');
    const { projectBalanceFlexTrace } = await import('../app/balance/balance-flex-trace.js');
    const { UIRenderer, initUIRenderer } = await import('../app/balance/balance-renderer.js');
    const { ActionRenderer } = await import('../app/balance/balance-renderer-action.js');
    const reserves = await import('../app/balance/balance-reserves.js');
    const { summarizeBalanceAction, describeBalanceActionSummary } = await import('../app/balance/balance-action-summary.js');
    const { projectOverviewFromRecords } = await import('../app/overview/overview-model.js');
    const { projectBalanceActionOrigin } = await import('../app/balance/balance-action-origin.js');
    const date = '2026-10-23';
    setAppTestDate(date);
    const records = createMusterHaushaltRecords(date, 'max-erika');
    await freshArea({ ...records });
    const storage = annualRecordStorage(records), api = createBalanceDisplayEngineApi(EngineAPI), now = () => new Date(`${date}T12:00:00`);
    const calculation = buildBalanceEngineInputFromStorage({ storage }), plan = calculation.householdPlan;
    const evaluation = evaluateBalanceFileInputs({ inputData: calculation.inputData, persistentState: calculation.history.persistentState,
        profiles: calculation.history.profiles, profileId: records.rs_current_profile, engineApi: api, publish: false,
        planInputs: plan.entry.values, marketPreviewContext: { calculation, storage },
        profilverbundHandlers: { runProfilverbundProfileSimulations: (input, profiles, state) => evaluateStoredAnnualHousehold(input, profiles, state,
            { engineApi: api, publish: false, withdrawalMode: plan.entry.values.householdWithdrawalMode }) } });
    const next = projectNextYearBudget({ storage, engineApi: api, now });
    const projected = next.displayEvaluation;
    const rounding = next.rule.components.find(item => item.kind === 'rounding');
    assertEqual(rounding.amount, 800, 'S3: Ausgangslage „Rundung der Planwerte +800 € Bedarf“');
    const projectedUi = { ...projected.modelResult.ui, input: projected.inputData };
    // GU-1b: Die Regel hängt an der Ursache im Engine-Trace, nicht mehr am Rundungsposten der Projektion.
    assertEqual(projectBalanceFlexTrace(projectedUi).cut, 0, 'S3: Auch ohne Projektion ist die Rundung keine Kürzung');
    const trace = projectBalanceFlexTrace({ ...projectedUi, nextYearBudget: next });
    assertEqual(trace.cut, 0, 'S3: Rundung der Planwerte ist keine Kürzung');
    const gap = projectBalanceFlexTrace({ ...projectedUi, input: { ...projected.inputData, flexBedarf: projected.inputData.flexBedarf + 6000 }, nextYearBudget: next });
    assertClose(gap.cut, 500 + 800 / 12, 1e-6, 'S3: Künstliche echte Lücke von 500 € im Monat meldet den vollen Unterschied zum Plan');
    assert(gap.householdFlexRate < 100, 'S3: Echte Lücke meldet weiter eine Finanzierungsquote unter 100 %');

    const entriesOf = runs => runs?.map(run => ({ profileId: run.profileId, name: run.name, action: run.ui.action, input: run.input, spending: run.ui.spending, targetLiquidity: run.ui.zielLiquiditaet })) || null;
    const current = { ...buildBalanceRendererPayload(evaluation.modelResult, evaluation.previewInputData || calculation.inputData), profileActionResults: entriesOf(evaluation.profilverbundRuns) };
    const model = projectOverviewFromRecords({ registry: JSON.parse(records.rs_profiles_v1), activeId: records.rs_current_profile, liveData: records, now: now() });
    const origin = projectBalanceActionOrigin({ comparison: model.planComparison, year: 2026, scope: model.scope, occasion: model.occasion });
    assert(origin.label.startsWith('Handlungsanweisung 2026'), 'S4: Seite zeigt die festgeschriebene Handlungsanweisung 2026');
    const source = reserves.currentYearActionSource(current, origin.confirmed);
    const entries = new ActionRenderer({}).prepareExecutionEntries(source.entries, current.zielLiquiditaet);
    const summary = summarizeBalanceAction(source.action, source.action, entries);
    assertClose(summary.amount, 89312.50, 0.01, 'S4: Handlungsanweisung 2026 lautet 89.312,50 € netto');
    const view = reserves.projectBalanceReserves(current, entries);
    assertEqual(view.before.liquidity, 90000, 'S4: Liquidität heute 90.000 €');
    assertClose(view.after.liquidity, 179312.50, 0.01, 'S4: Liquidität nach Umsetzung 90.000 € + 89.312,50 €');
    assert(describeBalanceActionSummary(summary, value => `${Math.round(value).toLocaleString('de-DE')} €`).includes('89.312 € netto'), 'S4: Diagnose nennt 89.312 € netto');

    // Derselbe Weg über die echte Balance-Darstellung.
    const doc = new MockDocument();
    const saved = { document: globalThis.document, window: globalThis.window };
    globalThis.document = doc; globalThis.window = { document: doc };
    try {
        const outputs = new Proxy({}, { get: (_, key) => typeof key === 'string' ? doc.getElementById(key) : undefined, has: () => true });
        initUIRenderer({ outputs, inputs: {}, containers: {} }, { loadState: () => ({}) });
        UIRenderer.render({ ...buildBalanceRendererPayload(projected.modelResult, { ...projected.inputData, referenceYear: next.targetYear }), nextYearBudget: next,
            currentYear: current, profileActionResults: entriesOf(projected.profilverbundRuns) });
        const text = id => doc.getElementById(id).textContent.replaceAll(' ', ' ');
        assert(text('balanceReserveValues').includes('nach Umsetzung179.312 €'), 'S4: Reservekarte zeigt 179.312 € nach Umsetzung');
        assertEqual(text('balanceBudgetCut'), 'Dein Haushalts-Flex ist voll finanziert.', 'S3: Keine Warnung „zu … % finanziert“ aus der Rundung');
    } finally { Object.assign(globalThis, saved); }
    P.resetPersistenceForTests(); setAppTestDate(null);
}

// S5: Pflegekostenanstieg heißt überall „Inflation + x %“ (FR-38); Wert unverändert.
{
    const { careValuesSummaryText } = await import('../app/shared/care-price-fields.js');
    assert(careValuesSummaryText(memory({})).includes('Kostenanstieg Inflation + 5 %'), 'S5: Pflegewerte-Zusammenfassung nennt „Inflation + 5 %“');
}
