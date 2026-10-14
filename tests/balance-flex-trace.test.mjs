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
    assertEqual(view.rows[0].value, trace[0].monatsbetragVorher, 'Anfang nutzt echten Netto-Flex');
    assertEqual(view.rows.at(-1).value, trace.at(-1).monatsbetragNachher, 'Endwert nutzt echte Auszahlung');
    assertEqual(view.rows.length, trace.filter(e => e.gegriffen).length + 2, 'Nur wirksame Stationen stehen in der Treppe');
    near(view.rows[0].value + view.rows.slice(1, -1).reduce((sum, row) => sum + row.value, 0), view.rows.at(-1).value,
        'Vorzeichenbehaftete Monatswirkungen schließen die Kette');
    near(Math.max(0, view.rows[0].value - view.rows.at(-1).value), view.cut, 'Trace-Kürzung entspricht Kartenkürzung auf Rohwertebene');
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

const hot = planner();
const curve = checkChain(hot);
assertEqual(curve.reason, 'Flex-Anteil', 'Heißer Markt mit S-Kurve nennt Flex-Anteil statt Bär oder CAPE');
assert(curve.rows.some(r => r.label === 'Begrenzung nach Flex-Anteil'), 'Kurze Entwurfsbezeichnung wird übernommen');
const bear = planner(p => { p.market = { sKey: 'bear_deep', abstandVomAthProzent: 35 }; p.input.minimumFlexAnnual = 30_000; });
const bearView = checkChain(bear);
assert(bearView.reason.includes('Bärenmarkt'), 'Bärenkürzung nennt den tatsächlichen strukturellen Grund');
assert(bearView.rows.some(r => r.kind === 'positive' && r.label === 'Mindest-Flex'), 'Mindest-Flex-Anhebung bleibt positiv');

const base = { depotwertAlt: 900_000, depotwertNeu: 0, goldWert: 0, tagesgeld: 100_000, geldmarktEtf: 0,
    inflation: 0, floorBedarf: 24_003.25, flexBedarf: 60_006.5, startAlter: 65,
    renteAktiv: true, renteMonatlich: 3_000.25, goldAktiv: false,
    risikoprofil: 'sicherheits-dynamisch', goldFloorProzent: 0, liquidityRunwayYears: 5, marketCapeRatio: 20 };
for (const input of [base, { ...base, dynamicFlex: true }]) {
    const result = EngineAPI.simulateSingleYear(input, null, { includeFlexTrace: true });
    const ui = { ...result.ui, input };
    const view = checkChain(ui);
    if (!input.dynamicFlex) near(view.rows[0].value, (input.flexBedarf - (input.renteMonatlich * 12 - input.floorBedarf)) / 12,
        'Haushaltsrente oberhalb Floor wird genau einmal vom Flex abgezogen');
    else {
        assert(ui.vpw.enabled, 'Dynamic-Flex-Fixture nutzt echten VPW-Pfad');
        near(view.grossNeed, ui.neuerBedarf / 12 + input.renteMonatlich, 'Dynamic Flex nutzt gelieferten Haushaltsbedarf');
    }
}

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
    'balanceBudgetChips', 'balanceBudgetCutAmount', 'balanceBudgetCutLegend', 'marktstatusText'].map(key => [key, doc.createElement('div')]));
let writes = 0;
resetPersistenceForTests({ getItemSync: () => null, setItemSync: () => { writes++; }, keysSync: () => [] });
try {
    const renderer = new SummaryRenderer({ outputs });
    const button = outputs.balanceBudgetWhy, region = outputs.balanceBudgetTrace;
    renderer.renderPlanCards(hot);
    assert(region.children.some(node => node.textContent.includes('Einschränkung liegt erst vor') && node.textContent.includes('Rentenbeitrag')), 'Warum-Treppe unterscheidet Wunsch-Kürzung und Mindest-Flex-Einschränkung');
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
    assertEqual(outputs.balanceBudgetCut.textContent, 'Dein flexibler Bedarf ist voll finanziert.', 'Vollfinanzierung erscheint nur bei gültigem ungekürztem Budget');
    assertEqual(outputs.balanceBudgetCut.getAttribute('data-financed'), 'true', 'Vollfinanzierung erhält den positiven Farbzustand');
    assert(button.hidden && region.hidden && !region.children.length, 'Ohne Kürzung fehlen Warum-Knopf und Treppe');
    renderer.renderPlanCards({});
    assertEqual(outputs.balanceBudgetCut.textContent, '', 'Ungültiger Bedarf behauptet keine Vollfinanzierung');
    renderer.renderPlanCards({ ...hot, spending: { ...hot.spending, flexTrace: undefined } });
    assert(button.hidden && !region.children.length && outputs.balanceBudgetCut.textContent.includes('gekürzt'), 'Altwerte behalten Kürzungszahl ohne erfundene Treppe');
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
