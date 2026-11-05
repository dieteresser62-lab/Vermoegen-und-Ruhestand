import strictAssert from 'node:assert/strict';
import fs from 'node:fs';
import { projectBalanceFlexTrace } from '../app/balance/balance-flex-trace.js';
import { SummaryRenderer } from '../app/balance/balance-renderer-summary.js';
import { SpendingPlanner } from '../engine/planners/SpendingPlanner.mjs';
import { EngineAPI } from '../engine/index.mjs';
import { createBalanceDisplayEngineApi } from '../app/balance/balance-update-pipeline.js';
import { createAnnualEngineLoader } from '../app/shared/annual-engine-loader.js';
import { createPresentationTestDocument } from './designsystem-source-contract.mjs';
import { resetPersistenceForTests, resetPersistenceRuntimeForTests } from '../app/shared/persistence-facade.js';

const near = (a, b, text) => assert(Math.abs(a - b) < 1e-7, text);
for (const [step, name] of [['previous_rate', 'Vorjahresanker'], ['internal_smoothing', 'Glättung'],
    ['annual_change_limit', 'Änderungsgrenze'], ['final_smoothing', 'Letzte Änderungsgrenze']]) {
    const view = projectBalanceFlexTrace({ input: { floorBedarf: 0, flexBedarf: 1200, renteAktiv: false },
        spending: { monatlicheEntnahme: 99, kuerzungQuelle: 'Grund aus dem Planner', flexTrace: [{ schritt: step, monatsbetragVorher: 100,
            monatsbetragNachher: 99, monatswirkungEur: -1, gegriffen: true }] } });
    assertEqual(view.rows[1].label, name, 'Treppe benennt ' + step + ' eindeutig');
    assertEqual(view.reason, 'Grund aus dem Planner', 'Kürzungsgrund für ' + step + ' kommt unverändert aus dem Planner');
}
const params = () => ({ lastState: null, market: { sKey: 'peak_hot', szenarioText: 'Markt heiß gelaufen', abstandVomAthProzent: 0 },
    inflatedBedarf: { floor: 24_000, flex: 60_000 }, runwayMonate: 60, profil: {},
    depotwertGesamt: 900_000, gesamtwert: 1_000_000, renteJahr: 0,
    input: { inflation: 0, liquidityRunwayYears: 5, floorBedarf: 24_000, flexBedarf: 60_000,
        minimumFlexAnnual: 0, flexBudgetAnnual: 0, endeVJ: 100, endeVJ_1: 100, endeVJ_2: 100 } });
function planner(change = () => {}) {
    const p = params(); change(p);
    return { input: { ...p.input, renteAktiv: false }, market: p.market,
        spending: SpendingPlanner.determineSpending(p).spendingResult };
}
function checkChain(ui) {
    const before = structuredClone(ui);
    const view = projectBalanceFlexTrace(ui);
    assert(view.rows.length > 1, 'Echter Planner-Trace liefert Anfang und Endwert');
    const trace = ui.spending.flexTrace;
    assertEqual(view.reason, ui.spending.kuerzungQuelle, 'Warum nennt denselben Grund wie Anmerkung und Simulator');
    assertEqual(view.rows[0].value, trace[0].monatsbetragVorher, 'Anfang nutzt echten Netto-Flex');
    assertEqual(view.rows.at(-1).value, trace.at(-1).monatsbetragNachher, 'Endwert nutzt echte Auszahlung');
    assertEqual(view.rows.length, trace.filter(e => e.gegriffen).length + 2, 'Nur wirksame Stationen stehen in der Treppe');
    near(view.rows[0].value + view.rows.slice(1, -1).reduce((sum, row) => sum + row.value, 0), view.rows.at(-1).value,
        'Vorzeichenbehaftete Monatswirkungen schließen die Kette');
    near(view.cut, Math.max(0, (ui.input.floorBedarf + ui.input.flexBedarf) / 12 - view.budget),
        'Kartenkürzung misst ausschließlich den Abstand zum Plan');
    if (!ui.vpw?.enabled) near(Math.max(0, view.rows[0].value - view.rows.at(-1).value), view.cut,
        'Ohne Dynamik entspricht die Trace-Kürzung der Kartenkürzung auf Rohwertebene');
    for (const row of view.rows) {
        assert(row.left >= 0 && row.width >= 0 && row.left + row.width <= 100.0000001, 'Treppenbalken bleibt innerhalb der echten Skala');
        if (row.kind === 'negative' || row.kind === 'positive') {
            const entry = trace.filter(e => e.gegriffen)[view.rows.indexOf(row) - 1];
            near(row.left * Math.max(...trace.flatMap(e => [e.monatsbetragVorher, e.monatsbetragNachher]), 1) / 100,
                Math.min(entry.monatsbetragVorher, entry.monatsbetragNachher), 'Wirkungsbalken verbindet Vorher und Nachher');
        }
    }
    strictAssert.deepEqual(ui, before);
    return view;
}

const hot = planner(p => { p.lastState = { initialized: true, flexRate: 50,
    cumulativeInflationFactor: 1, peakRealVermoegen: 1_000_000,
    lastTotalBudget: 84_000, lastMarketSKey: 'side_long' }; });
const curve = checkChain(hot);
assertEqual(curve.rows[0].label, 'Geplante Vermögensentnahme (Flex-Anteil)', 'Ungedeckter Floor bleibt außerhalb der benannten Flex-Entnahmetreppe');
assertEqual(curve.rows.at(-1).label, 'Finanzierte Vermögensentnahme (Flex-Anteil)', 'Finanzierter Treppenwert ist kein Haushalts-Flex');
assertEqual(curve.reason, 'Guardrail (Vorsicht)', 'Gesperrter Floor nennt allein den im Ergebnis stärksten Grund');
assert(curve.rows.some(r => r.label === 'Begrenzung nach Flex-Anteil'), 'Kurze Entwurfsbezeichnung wird übernommen');
const bear = planner(p => { p.market = { sKey: 'bear_deep', abstandVomAthProzent: 35 }; p.input.minimumFlexAnnual = 30_000; });
const bearView = checkChain(bear);
assertEqual(bearView.reason, 'Tiefer Bär', 'Bärenkürzung nennt denselben verbleibenden Grund wie die Engine');
assert(bearView.rows.some(r => r.kind === 'positive' && r.label === 'Mindest-Flex'), 'Mindest-Flex-Anhebung bleibt positiv');
const emergency = planner(p => {
    p.market = { sKey: 'bear_deep', abstandVomAthProzent: 35 };
    p.lastState = { initialized: true, flexRate: 80, cumulativeInflationFactor: 1,
        peakRealVermoegen: 1_600_000, lastTotalBudget: 84_000, lastMarketSKey: 'side_long' };
    p.input.minimumFlexAnnual = 30_000;
});
assertEqual(checkChain(emergency).reason, 'Safety-Cap (schwere Flex-Notlage)',
    'Warum nennt bei bindender Notlage immer denselben Safety-Cap wie der Simulator');
const blockedDecline = planner(p => {
    p.lastState = { initialized: true, flexRate: 93.5, flexRateSmoothingReference: 95.8,
        cumulativeInflationFactor: 1, peakRealVermoegen: 1_000_000, lastTotalBudget: 84_000, lastMarketSKey: 'side_long' };
});
assert(blockedDecline.spending.details.flexRate < 93.5, 'NR-1: synthetischer gesperrter Floor endet unter der Vorjahresrate');
assertEqual(checkChain(blockedDecline).reason, 'Guardrail (Vorsicht)', 'NR-1: Balance nennt bei gesperrter Anhebung denselben Vorsichtsgrund');
assert(blockedDecline.spending.anmerkung.includes('Guardrail (Vorsicht)'), 'NR-1: Balance-Anmerkung nennt ebenfalls Vorsicht');

const base = { depotwertAlt: 900_000, depotwertNeu: 0, goldWert: 0, tagesgeld: 100_000, geldmarktEtf: 0,
    inflation: 0, floorBedarf: 24_003.25, flexBedarf: 60_006.5, startAlter: 65,
    renteAktiv: true, renteMonatlich: 3_000.25, goldAktiv: false,
    risikoprofil: 'sicherheits-dynamisch', goldFloorProzent: 0, liquidityRunwayYears: 5, marketCapeRatio: 20 };
for (const input of [base, { ...base, dynamicFlex: true }]) {
    const result = EngineAPI.simulateSingleYear(input, null, { includeFlexTrace: true });
    const ui = { ...result.ui, input };
    const view = checkChain(ui);
    near(view.financedHouseholdFlex, view.budget - input.floorBedarf / 12, 'Finanzierter Haushalts-Flex enthält den Rentenüberschuss');
    near(view.financedHouseholdFlex - view.withdrawal, input.renteMonatlich - input.floorBedarf / 12, 'Rentenanteil und Vermögensentnahme bleiben getrennte Größen');
    if (!input.dynamicFlex) near(view.rows[0].value, (input.flexBedarf - (input.renteMonatlich * 12 - input.floorBedarf)) / 12,
        'Haushaltsrente oberhalb Floor wird genau einmal vom Flex abgezogen');
    else {
        assert(ui.vpw.enabled, 'Dynamic-Flex-Fixture nutzt echten VPW-Pfad');
        near(view.grossNeed, (input.floorBedarf + input.flexBedarf) / 12, 'Dynamic Flex vergleicht mit dem Haushaltsplan');
        near(view.householdFlex, input.flexBedarf / 12, 'Dynamic Flex verändert den angezeigten Wunsch-Flex nicht');
    }
}

const review = projectBalanceFlexTrace({ input: { renteAktiv: true, renteMonatlich: 3100, floorBedarf: 30750, flexBedarf: 30000 },
    spending: { monatlicheEntnahme: 1850, details: { flexRate: 94.3 } } });
near(review.financedHouseholdFlex, 2387.5, 'Review: 4.950 Euro Budget finanzieren 2.387,50 Euro Haushalts-Flex');
near(review.householdFlexRate, 95.5, 'Review: Haushaltsquote bezieht sich auf 2.500 Euro Wunsch-Flex einschließlich Rentenanteil');

const full = planner(p => { p.gesamtwert = 11_000_000; p.inflatedBedarf = { floor: 24_000, flex: 12_000 };
    p.input.floorBedarf = 24_000; p.input.flexBedarf = 12_000; });
assertEqual(checkChain(full).cut, 0, 'Gültiger voll finanzierter Bedarf hat keine Kürzung');
for (const ui of [{}, { ...hot, spending: { ...hot.spending, flexTrace: undefined } },
    { ...hot, input: {} }, { ...hot, spending: { ...hot.spending, flexTrace: [{ ...hot.spending.flexTrace[0], monatsbetragNachher: NaN }] } }]) {
    assertEqual(projectBalanceFlexTrace(ui).rows.length, 0, 'Fehlender Trace oder Bedarf erzeugt keine fingierten Stufen');
}

const previousDocument = globalThis.document;
const doc = createPresentationTestDocument(); globalThis.document = doc;
const outputs = Object.fromEntries(['balanceMonthlyBudget', 'balanceBudgetCut', 'balanceBudgetWhy', 'balanceBudgetTrace',
    'balanceBudgetChips', 'balanceNeedRows', 'balanceBudgetBar', 'balanceFlowNeed', 'marktstatusText'].map(key => [key, doc.createElement('div')]));
let writes = 0;
resetPersistenceForTests({ getItemSync: () => null, setItemSync: () => { writes++; }, keysSync: () => [] });
try {
    const renderer = new SummaryRenderer({ outputs });
    const button = outputs.balanceBudgetWhy, region = outputs.balanceBudgetTrace;
    renderer.renderPlanCards(hot);
    assert(region.children.some(node => node.textContent.includes('Guardrail (Vorsicht)')),
        'Balance zeigt bei gesperrtem Floor den Vorsichtsgrund');
    assert(region.children.some(node => node.children?.[0]?.children?.[1]?.textContent.includes('Einschränkung liegt erst vor') && node.children[0].children[1].textContent.includes('Rentenbeitrag')), 'Warum-Treppe unterscheidet Wunsch-Kürzung und Mindest-Flex-Einschränkung');
    assert(!button.hidden && region.hidden && button.getAttribute('aria-expanded') === 'false', 'Jedes Ergebnis beginnt mit geschlossener Warum-Treppe');
    for (let i = 0; i < 3; i++) {
        button.click(); assert(!region.hidden && button.getAttribute('aria-expanded') === 'true', 'Warum lässt sich wiederholt öffnen');
        button.click(); assert(region.hidden && button.getAttribute('aria-expanded') === 'false', 'Warum lässt sich wiederholt schließen');
    }
    button.click(); renderer.renderPlanCards(bear);
    assert(region.hidden && button.getAttribute('aria-expanded') === 'false', 'Neuer Ergebnis-/Profilrender schließt die Treppe');
    button.click(); assert(!region.hidden, 'Idempotente Bindung toggelt nach Neurendern genau einmal');
    assert(region.children.some(row => row.className.includes('positive') && row.children[2].textContent.startsWith('+')), 'Anhebungen zeigen Pluswerte in EUR/Monat');
    renderer.renderPlanCards(hot); renderer.renderMarktstatus(hot.market);
    assert(!outputs.balanceBudgetChips.children.some(n => /^(Grund:|Flex-Rate|Liquidität)/.test(n.textContent)), 'Monatsbudget wiederholt keine Diagnosechips');
    assert(region.children.some(n => n.children?.[0]?.textContent === 'Begrenzung nach Flex-Anteil'), 'Belegter Kürzungsgrund bleibt über Warum erreichbar');
    assert(!outputs.balanceBudgetChips.children.some(n => n.textContent === hot.market.szenarioText), 'Marktphase steht außerhalb der Budgetchips');
    assertEqual(outputs.marktstatusText.children[0].children[0].textContent, hot.market.szenarioText || '', 'Marktphase bleibt in der Marktkarte');
    renderer.renderPlanCards(full);
    assertEqual(outputs.balanceBudgetCut.textContent, 'Dein Haushalts-Flex ist voll finanziert.', 'Vollfinanzierung erscheint nur bei gültigem ungekürztem Budget');
    assertEqual(outputs.balanceBudgetCut.getAttribute('data-financed'), 'true', 'Vollfinanzierung erhält den positiven Farbzustand');
    assert(button.hidden && region.hidden && !region.children.length, 'Ohne Kürzung fehlen Warum-Knopf und Treppe');
    renderer.renderPlanCards({});
    assertEqual(outputs.balanceBudgetCut.textContent, '', 'Ungültiger Bedarf behauptet keine Vollfinanzierung');
    renderer.renderPlanCards({ ...hot, spending: { ...hot.spending, flexTrace: undefined } });
    assert(button.hidden && !region.children.length && outputs.balanceBudgetCut.textContent.includes('weniger im Monat'), 'Altwerte behalten Kürzungszahl ohne erfundene Treppe');
    for (const withdrawal of [1200, 400]) {
        const ui = { input: { renteAktiv: true, renteMonatlich: 2300, floorBedarf: 24000, flexBedarf: 12000, dynamicFlex: true },
            vpw: { enabled: true }, neuerBedarf: 20400,
            spending: { monatlicheEntnahme: withdrawal, kuerzungQuelle: 'Sicherheitsgrenze', flexTrace: [{ schritt: 'safety_cap',
                monatsbetragVorher: 1700, monatsbetragNachher: withdrawal,
                monatswirkungEur: withdrawal - 1700, gegriffen: true }] } };
        const before = JSON.stringify(ui);
        const view = checkChain(ui);
        renderer.renderPlanCards(ui);
        const need = outputs.balanceNeedRows.children.flatMap(group => group.children.slice(1)).find(row => row.children[0].textContent === 'Wunschbedarf (Flex)');
        assert(need.children[1].children[0].textContent.includes('1.000'), 'Wunschbedarf zeigt Plan-Flex 1.000 Euro');
        assert(need.children[1].children.at(-1).textContent.includes('Dynamik erlaubt bis 2.000'), 'Dynamikgrenze steht klein unter dem Plan-Flex');
        assertEqual(view.householdFlexRate, withdrawal === 1200 ? 150 : 70, 'Finanzierter Haushalts-Flex bezieht sich auf den Plan-Flex');
        if (withdrawal === 1200) {
            assert(outputs.balanceBudgetCut.textContent.includes('500') && outputs.balanceBudgetCut.textContent.includes('über dem Plan (Dynamik)'),
                'Budget über Plan nennt den dynamischen Mehrbetrag');
            assertEqual(outputs.balanceBudgetCut.getAttribute('data-financed'), 'above-plan', 'Dynamischer Mehrbetrag erhält den neutralen Farbzustand');
            const rate = outputs.balanceNeedRows.children.flatMap(group => group.children.slice(1)).find(row => row.children[0].textContent === 'Haushalts-Flex finanziert');
            assertEqual(rate.children[1].textContent, '150\u00a0%', 'Über 100 Prozent ohne Nachkommastelle');
            assert(!outputs.balanceFlowNeed.textContent.includes('gekürzt') && button.hidden,
                'Über Plan erscheinen weder gekürzt noch Warum-Knopf');
            assert(!outputs.balanceBudgetBar.children.some(node => node.className.includes('monthly-flow-cut')), 'Über Plan enthält der Balken keine Kürzung');
        } else {
            assert(outputs.balanceBudgetCut.textContent.includes('300') && outputs.balanceBudgetCut.textContent.includes('weniger im Monat'),
                'Unter Plan beträgt die Kürzung 300 Euro statt 1.300 Euro zum dynamischen Rahmen');
            assertEqual(outputs.balanceBudgetCut.getAttribute('data-financed'), 'false', 'Budget unter Plan bleibt rot');
            assert(!button.hidden && outputs.balanceBudgetCut.textContent.includes('300') && outputs.balanceFlowNeed.textContent === '', 'Plan-Kürzung behält die echte Warum-Treppe');
            assert(outputs.balanceBudgetBar.children.some(node => node.className.includes('monthly-flow-cut')), 'Unter Plan enthält der Balken die Kürzung');
        }
        assertEqual(JSON.stringify(ui), before, 'Anzeige lässt sämtliche gelieferten Enginewerte bytegleich');
    }
    assertEqual(writes, 0, 'Öffnen, Schließen und Ergebnisrender schreiben keinen Speicher');
} finally { globalThis.document = previousDocument; resetPersistenceRuntimeForTests(); }
const source = fs.readFileSync(new URL('../app/balance/balance-main.js', import.meta.url), 'utf8');
assert(source.includes('createBalanceDisplayEngineApi(engineApi)')
    && source.includes('engineApi: displayEngineApi'), 'Balance fordert Trace am vorhandenen Rechenaufruf an');
const api = createBalanceDisplayEngineApi(EngineAPI);
const annualApi = await createAnnualEngineLoader({ readActiveApi: () => api }).load();
const displayed = annualApi.simulateSingleYear(base, null);
const plain = EngineAPI.simulateSingleYear(base, null);
const { flexTrace, ...spending } = displayed.ui.spending;
assert(Array.isArray(flexTrace), 'Auch unmittelbar bestätigte Balance-Jahresergebnisse enthalten den Trace');
strictAssert.deepEqual({ ...displayed, ui: { ...displayed.ui, spending } }, plain);
assert(!JSON.stringify(displayed.newState).includes('flexTrace'), 'Anzeigeadapter verändert weder Fachwerte noch persistierbaren State');
assertEqual(createBalanceDisplayEngineApi(null), null, 'Fehlende Engine behält den Loader-Fallback');
console.log('Warum-Treppe: echte Planner-/Renten-/Dynamic-Flex-Monatswerte und schreibfreie DOM-Bedienung geprüft.');
