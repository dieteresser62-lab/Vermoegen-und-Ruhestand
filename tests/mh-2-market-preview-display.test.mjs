import fs from 'node:fs';
import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { prepareMarketPreview, projectMarketPreview, compareMarketBudgets, classifyMarketPreview, isHiddenBearMarket } from '../app/balance/balance-market-preview.js';
import { renderBalanceMarketPreview, createAnnualMarketReadings } from '../app/balance/balance-market-preview-renderer.js';
import { emptyHistorySymbol, historyDay } from '../app/tranches/tranchen-history-store.js';
import { MockDocument } from './helpers/balance-page-fixture.mjs';

const inputs = { endeVJ: 150, endeVJ_1: 140, endeVJ_2: 120, endeVJ_3: 110, ath: 150, jahreSeitAth: 0 };
const records = createMusterHaushaltRecords('2026-10-30', 'max-erika');
const calculation = buildBalanceEngineInputFromStorage({ storage: { getItem: key => records[key] ?? null }, referenceYear: 2026 });
function project({ equal = false, closed = true, quote = true, lower = false } = {}) {
    const market = lower ? { ...inputs, endeVJ: 105, ath: 105 } : inputs;
    const days = (lower ? ['2027-01-14', '2027-02-12'] : ['2026-07-14', '2026-10-30']).map(historyDay);
    const dailyPrices = quote ? { version: 1, symbols: { 'VWCE.DE': { ...emptyHistorySymbol(), currency: 'EUR', days,
        closes: lower ? [140, 103] : equal ? [150, 150] : [200, 170], queried: [[days[0], days[1]]] } } } : null;
    const prepared = prepareMarketPreview({ inputs: market, dailyPrices, today: lower ? '2027-02-12' : '2026-10-30',
        yearEndDate: lower ? '2026-12-31' : '2025-12-31', hasAnnualClose: closed });
    const run = values => EngineAPI.simulateSingleYear({ ...calculation.engineInput, ...values }, calculation.engineLastState);
    const results = { stored: run(market), rule: run(prepared.ruleInputs), high: run(prepared.highInputs) };
    return { ...projectMarketPreview(prepared, results), results };
}
const doc = new MockDocument(), get = id => doc.getElementById(id);
const text = node => node.textContent.replaceAll('\u00a0', ' ');
const descendants = node => [node, ...node.children.flatMap(descendants)];
const tags = (root, tag) => descendants(root).filter(node => node.tagName.toLowerCase() === tag);
const render = view => {
    const before = JSON.stringify(view); renderBalanceMarketPreview(doc, view);
    assertEqual(JSON.stringify(view), before, 'Renderer lässt Projektion bytegleich');
    return get('balanceMarketPreviewBody');
};
const different = project(), lower = project({ lower: true }), same = project({ equal: true });
const higher = structuredClone(lower);
higher.comparison = compareMarketBudgets(lower.results.high, lower.results.rule);
const phaseOnly = structuredClone(different);
phaseOnly.comparison = compareMarketBudgets(different.results.rule, different.results.rule);
assert(different.rule.market.key !== different.high.market.key, 'p24 hat verschiedene Marktphasen');
assertEqual(different.comparison.state, 'budget_same_action_differs', 'p24 hat nur eine andere Umschichtung');
assertEqual(lower.comparison.state, 'budget_lower', 'Februar-Sollfall hat weniger Budget');
// WT-1 (FR-77 Punkt 5): Die Stufen bleiben intern. Angezeigt wird nur der verdeckte Bärenmarkt; im Jahresabschluss steht
// sonst höchstens „nicht belastbar“, wenn Kurse fehlen und es auf sie ankäme.
for (const [view, stage] of [[same, 'calm'], [phaseOnly, 'notice'], [different, 'warning'], [lower, 'warning'], [higher, 'warning'],
    [project({ quote: false }), 'not_reliable']]) {
    assertEqual(classifyMarketPreview(view).stage, stage, 'Gemeinsame Anzeigestufe: ' + stage);
    render(null);
    const body = render(view), hidden = isHiddenBearMarket(view);
    // WT-1b (Soll 6): Fehlende oder alte Kurse zeigen statt des Blocks genau eine kleine Zeile mit „Kurse holen →“.
    assertEqual(!get('balanceMarketPreview').hidden, hidden || stage === 'not_reliable', 'Block nur bei verdecktem Bärenmarkt, Zeile bei fehlenden Kursen: ' + stage);
    // WT-1c: Der Text nennt den Grund; ohne Kurs heißt es „Kurse fehlen oder sind lückenhaft“.
    if (stage === 'not_reliable') assertEqual(text(body), 'Kurse fehlen oder sind lückenhaft – verdeckter Bärenmarkt nicht prüfbar · Kurse holen →', 'Fehlende Kurse: genau eine Zeile');
    else if (!hidden) assertEqual(body.children.length, 0, 'Kein Jahreshoch ohne verdeckten Bären: ' + stage);
    else {
        assert(text(body).includes('Bärenmarkt, den die Jahresregel nicht sieht') && text(body).includes('Was das für'), 'Verdeckter Bär mit Folgen: ' + stage);
        const history = tags(body, 'details')[0];
        assert(!history.open && tags(history, 'svg')[0].getAttribute('aria-label').includes('Sicht der Jahresendregel'), 'Kursverlauf zugeklappt mit Bildbeschreibung');
    }
    assertEqual(!get('balanceHighBudget').hidden, hidden && ['budget_lower', 'budget_higher'].includes(view.comparison.state), 'Budgetzeile nur bei verdecktem Bären mit anderem Budget: ' + stage);
    const annual = createAnnualMarketReadings(doc, view);
    assertEqual(annual.hidden, stage !== 'not_reliable', 'Jahresabschluss zeigt nur fehlende Kurse: ' + stage);
    if (stage === 'not_reliable') assert(text(annual.children[0]).includes('Kurse auf Daten & Sicherung holen'), 'Nicht belastbar mit Kurslink');
}
for (const [reason, line] of [['Kursreihe hat ungeprüfte Tage', 'Kurse fehlen oder sind lückenhaft'], ['letzter Schlusskurs älter als 10 Kalendertage', 'Kurse älter als 10 Tage']]) {
    const view = structuredClone(different); view.comparison.state = 'not_reliable'; view.comparison.reason = reason;
    // WT-1b (Soll 6): Statt des Vergleichs steht genau eine kleine Zeile mit „Kurse holen →“; WT-1c: Text passt zum Grund.
    const body = render(view);
    assert(!get('balanceMarketPreview').hidden && text(body) === `${line} – verdeckter Bärenmarkt nicht prüfbar · Kurse holen →`,
        'Balance zeigt bei nicht belastbaren Kursen nur die Kurszeile: ' + reason);
}
render(null); assert(get('balanceMarketPreview').hidden && !get('balanceMarketPreviewBody').children.length, 'Neuer Start entfernt alten Block');
const absent = createAnnualMarketReadings(doc, null); assert(absent.hidden && !absent.children.length, 'Vor Kursabruf kein Jahresvergleich');
const html = fs.readFileSync(new URL('../Balance.html', import.meta.url), 'utf8');
for (const label of ['nach Regel (Jahresendstände)', 'Was zu tun ist', 'Vorschau auf den Plan', 'Details der Vorschau']) assert(html.includes(label), 'Statische Beschriftung: ' + label);
for (const label of ['Vorläufige Empfehlung · nach Regel', 'Budgetprüfung für das nächste Jahr']) assert(!html.includes(label), 'Entfernte Beschriftung: ' + label);

// Produktiver Balancezugang: Tageswerte in der Vorschau, Jahreswerte bei ihrer Herkunft.
const { PersistenceFacade: P } = await import('../app/shared/persistence-facade.js');
const { CONFIG } = await import('../app/balance/balance-config.js');
const { UIReader } = await import('../app/balance/balance-reader.js');
const { MockEvent } = await import('./helpers/balance-page-fixture.mjs');
const { installAnnualLocks } = await import('./helpers/balance-storage-fixtures.mjs');
const { getAppTestDate, setAppTestDate } = await import('../app/shared/app-clock.js');
const globals = Object.fromEntries(['window', 'document', 'Event'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const originalDate = getAppTestDate(), restoreLocks = installAnnualLocks();
try {
    const registry = JSON.parse(records.rs_profiles_v1);
    for (const profile of Object.values(registry.profiles)) {
        const state = JSON.parse(profile.data[CONFIG.STORAGE.LS_KEY]);
        state.inputs = { ...state.inputs, ...inputs };
        state.profilverbundHouseholdInputs = { ...state.profilverbundHouseholdInputs, ...inputs };
        for (const [id, value] of Object.entries(inputs)) (state.balanceInputFields ||= {})[id] = { value: String(value), checked: false };
        profile.data[CONFIG.STORAGE.LS_KEY] = JSON.stringify(state);
    }
    const { DAILY_PRICES_KEY } = await import('../app/tranches/tranchen-history-store.js');
    const live = { ...records, rs_profiles_v1: JSON.stringify(registry),
        [CONFIG.STORAGE.LS_KEY]: registry.profiles[records.rs_current_profile].data[CONFIG.STORAGE.LS_KEY],
        [DAILY_PRICES_KEY]: JSON.stringify({ version: 1, symbols: { 'VWCE.DE': { ...emptyHistorySymbol(), currency: 'EUR',
            days: ['2026-07-14', '2026-10-30'].map(historyDay), closes: [200, 170], queried: [[historyDay('2026-07-14'), historyDay('2026-10-30')]] } } }) };
    globalThis.document = new MockDocument();
    globalThis.Event = MockEvent;
    globalThis.window = { EngineAPI, addEventListener() {}, location: { href: 'http://localhost/Balance.html', hash: '' } };
    setAppTestDate('2026-10-30');
    P.resetPersistenceForTests({ name: 'mh-2-memory', async loadAll() { return { ...live }; },
        async saveBatch({ deletes, upserts }) { deletes.forEach(key => delete live[key]); Object.assign(live, Object.fromEntries(upserts)); } });
    await P.init({ installLifecycleHooks: false, installTauriCloseHook: false });
    const main = await import('../app/balance/balance-main.js');
    const initial = await main.init(); assert(initial.ok, 'Produktiver Balance-Start erfolgreich'); await initial.overviewPersistence;
    setAppTestDate('2026-10-30');
    const update = main.update({ mode: 'preview' }); assert(update.ok, 'Produktive Tageskursvorschau erfolgreich'); await update.overviewPersistence;
    const content = id => text(document.getElementById(id));
    assert(document.getElementById('balanceMarketPreview').hidden, 'Produktiver Renderer: junge Korrektur ist kein verdeckter Bär');
    assertEqual(content('balanceMarket-endeVJ-value'), '150,00 €', 'Strategiekachel zeigt gespeicherte Jahresbasis statt Tageskurs');
    assertEqual(content('balanceMarket-ath-value'), '150,00 €', 'Herkunft und gespeichertes Hoch passen zusammen');
    assert(content('marketDataProvenance').startsWith('Jahresmarktdaten ·'), 'Gespeicherte Provenienz ausdrücklich benannt');
    assert(content('balanceMarketSource').includes('Vorschau nach Regel · VWCE.DE · Schlusskurs 30.10.2026'), 'Marktfakten bekommen die Vorschauherkunft');
    assertEqual(content('balanceActionPreviewTitle'), 'Vorschau auf den Plan 2027', 'Produktiver Renderer zeigt die Vorschauzeile');
} finally {
    UIReader.planFormSource = null;
    restoreLocks(); P.resetPersistenceRuntimeForTests(); setAppTestDate(originalDate);
    for (const [key, descriptor] of Object.entries(globals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
}
