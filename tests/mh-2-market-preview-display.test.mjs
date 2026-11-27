import fs from 'node:fs';
import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { prepareMarketPreview, projectMarketPreview } from '../app/balance/balance-market-preview.js';
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
    return projectMarketPreview(prepared, EngineAPI.simulateSingleYear({ ...calculation.engineInput, ...prepared.marketInputs }, calculation.engineLastState));
}
const doc = new MockDocument(), get = id => doc.getElementById(id);
const text = node => node.textContent.replaceAll('\u00a0', ' ');
const render = view => {
    const before = JSON.stringify(view); renderBalanceMarketPreview(doc, view);
    assertEqual(JSON.stringify(view), before, 'Renderer lässt Projektion bytegleich');
    return get('balanceMarketPreviewBody');
};
const different = project(), lower = project({ lower: true }), same = project({ equal: true }), missing = project({ quote: false });
assertEqual(different.high.value, 200, 'Tageshoch 200 ist das Allzeithoch');
assert(lower.deepBear.cutActive, 'Februar-Sollfall: Kürzung aktiv');
// FR-89: „Was zu tun ist“ zeigt zum Hoch nur noch die Kurszeile bei nicht belastbaren Kursen; Hoch, Abstand, Marktlage und
// Kursschwelle stehen im Jahresabschluss im Schritt Marktdaten und in der Balance in der Marktkachel.
for (const [view, label, reliable] of [[same, 'am Hoch', true], [different, 'junge Korrektur', true], [lower, 'tiefer Bär', true], [missing, 'ohne Kurs', false]]) {
    render(null);
    const body = render(view);
    assertEqual(!get('balanceMarketPreview').hidden, !reliable, 'Zeile nur bei fehlenden Kursen: ' + label);
    if (!reliable) assertEqual(text(body), 'Kurse fehlen oder sind lückenhaft – Allzeithoch nicht belastbar · Kurse holen →', 'Fehlende Kurse: genau eine Zeile');
    else assertEqual(body.children.length, 0, 'Belastbare Kurse: nichts in „Was zu tun ist“: ' + label);
    const annual = createAnnualMarketReadings(doc, view);
    assert(!annual.hidden && text(annual).includes('Allzeithoch') && text(annual).includes('Tiefer Bär'), 'Jahresabschluss zeigt Hoch und Kursschwelle: ' + label);
    assertEqual(text(annual).includes('Kurse auf Daten & Sicherung holen'), !reliable, 'Nicht belastbar mit Kurslink nur bei fehlenden Kursen: ' + label);
}
for (const [reason, line] of [['Kursreihe hat ungeprüfte Tage – Kurse auf der Seite Daten & Sicherung holen', 'Kurse fehlen oder sind lückenhaft'], ['letzter Schlusskurs älter als 10 Kalendertage', 'Kurse älter als 10 Tage']]) {
    const view = { ...structuredClone(different), unreliableReason: reason };
    // WT-1b (Soll 6), WT-1c: genau eine kleine Zeile mit „Kurse holen →“; der Text passt zum Grund.
    const body = render(view);
    assert(!get('balanceMarketPreview').hidden && text(body) === `${line} – Allzeithoch nicht belastbar · Kurse holen →`,
        'Balance zeigt bei nicht belastbaren Kursen nur die Kurszeile: ' + reason);
    // Kürzt die Engine schon, kann ein fehlender Kurs das Hoch nur anheben; dann keine Zeile.
    render({ ...structuredClone(lower), unreliableReason: reason });
    assert(get('balanceMarketPreview').hidden, 'Kürzung aktiv: fehlende Kurse ändern nichts: ' + reason);
}
render(null); assert(get('balanceMarketPreview').hidden && !get('balanceMarketPreviewBody').children.length, 'Neuer Start entfernt alte Zeile');
const absent = createAnnualMarketReadings(doc, null); assert(absent.hidden && !absent.children.length, 'Vor Kursabruf keine Marktlage im Jahresabschluss');
const html = fs.readFileSync(new URL('../Balance.html', import.meta.url), 'utf8');
for (const label of ['Was zu tun ist', 'Vorschau auf den Plan', 'Details der Vorschau']) assert(html.includes(label), 'Statische Beschriftung: ' + label);
for (const label of ['Vorläufige Empfehlung · nach Regel', 'Budgetprüfung für das nächste Jahr', 'nach Regel (Jahresendstände)', 'balanceHighBudget', 'Bärenmarkt, den die Jahresregel nicht sieht'])
    assert(!html.includes(label), 'Entfernte Beschriftung: ' + label);

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
            // Die Referenzreihe ist ab Historienstart abgefragt (ATH-1b); Lücken davor wären „nicht belastbar“.
            days: ['2026-07-14', '2026-10-30'].map(historyDay), closes: [200, 170], queried: [[historyDay('2025-01-01'), historyDay('2026-10-30')]] } } }) };
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
    assert(document.getElementById('balanceMarketPreview').hidden, 'Produktiver Renderer: belastbare Kurse, keine Zeile in „Was zu tun ist“');
    const facts = content('balanceMarketFacts');
    assert(facts.includes('Allzeithoch') && facts.includes('200,00 € · Tagesschluss vom 14.07.2026'), `Marktkachel nennt das Allzeithoch mit Tagesschluss (${facts})`);
    assert(facts.includes('Tiefer Bär') && facts.includes('unter 160,00 € · noch 5,9 % Abstand'), `Marktkachel nennt die Kursschwelle mit Restabstand (${facts})`);
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
