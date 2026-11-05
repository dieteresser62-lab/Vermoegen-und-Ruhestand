import fs from 'node:fs';
import { EngineAPI } from '../engine/index.mjs';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { buildBalanceEngineInputFromStorage } from '../app/balance/balance-input-storage.js';
import { prepareMarketPreview, projectMarketPreview, compareMarketBudgets } from '../app/balance/balance-market-preview.js';
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
for (const [view, stage, title, historyOpen] of [
    [same, 'calm', 'Nahe am Jahreshoch – keine Auswirkung auf die Planung', false],
    [phaseOnly, 'notice', 'Der Kurs liegt 15,0 % unter dem Jahreshoch', true],
    [different, 'warning', 'Der Markt war in diesem Jahr schon viel heißer', true],
    [lower, 'warning', 'Der Markt war in diesem Jahr schon viel heißer', true],
    [higher, 'warning', 'Der Markt war in diesem Jahr schon viel heißer', true],
    [project({ quote: false }), 'not_reliable', 'Vergleich mit dem Jahreshoch nicht möglich', false]
]) {
    render(null);
    const body = render(view), result = body.children[0];
    assertEqual(result.dataset.marketStage, stage, 'Gemeinsame Anzeigestufe: ' + stage);
    assert(text(result).includes(title), 'Ergebnis zuerst: ' + stage);
    assertEqual(result.children[0].className.includes('result-warning'), stage === 'warning', 'Alle unterschiedlichen Folgen warnen: ' + stage);
    const details = tags(body, 'details');
    assertEqual(details.length, stage === 'not_reliable' ? 2 : 3, 'Jahresverlauf und bestehende Klappen: ' + stage);
    if (stage !== 'not_reliable') {
        assertEqual(text(details[0].children[0]), 'Jahresverlauf', 'Kursverlauf vor Detailvergleichen');
        assertEqual(details[0].open, historyOpen, 'Jahresverlauf nach Stufe geöffnet: ' + stage);
        assert(tags(details[0], 'svg')[0].getAttribute('aria-label').includes('Sicht der Jahresendregel'), 'Kurslinie mit Bildbeschreibung');
        assertEqual(tags(details[0], 'path')[0].getAttribute('stroke'), 'var(--text-main)', 'Kurslinie aus Tokens');
        assert(tags(details[0], 'line').some(node => node.getAttribute('stroke-dasharray') === '2 5'), 'Jahresendregel gepunktet');
        assert(tags(details[0], 'line').some(node => node.getAttribute('stroke-dasharray') === '6 4'), 'Bärengrenze gestrichelt');
        assertEqual(text(details[1].children[0]), 'Budget im Vergleich', 'Budgetklappe bleibt');
        assertEqual(text(details[2].children[0]), 'Markt und Umschichtung', 'Marktklappe bleibt');
        assertEqual(tags(details[1], 'tbody')[0].children.length, 4, 'Vier Budgetzeilen bleiben');
        if (stage !== 'calm') {
            assert(text(result).includes('Zwei Lesarten des Hochs'), 'Lesarten bei Hinweis und Warnung');
            assertEqual(tags(result, 'tbody')[0].children.length, 5, 'Hoch, Abstand, Marktlage, Budget und Verkauf');
        }
        if (stage === 'warning') assert(tags(result, 'td').some(node => node.className === 'balance-preview-cell-warning' && /anders|weniger|mehr/.test(text(node))), 'Abweichung mit Farbe und Wort');
    } else {
        assert(text(result).includes('Nicht bewertet'), 'Nicht belastbar mit Chip');
        assert(text(result).includes('Kurse auf Daten & Sicherung holen'), 'Nicht belastbar mit Kurslink');
    }
    const annual = createAnnualMarketReadings(doc, view);
    assertEqual(annual.children[1].dataset.marketStage, stage, 'Jahresabschluss nutzt dieselbe Stufe');
}
assert(text(render(lower)).includes('um 300 € niedriger: 4.700 € statt 5.000 €'), 'Budgetdifferenz mit beiden Monatsbeträgen');
assert(text(render(phaseOnly)).includes('Ab wann es zählt: Fällt der Kurs unter 160,00 € (noch 5,9 %)'), 'Hinweis erklärt Schwelle und Restabstand');
assert(text(render(same)).includes('ändert hier weder Budget noch Verkauf'), 'Ruhige Erklärung');
const body = render(different);
assert(text(body).includes('Index unter 120,00 €'), 'Regelschwelle verwendet gespeichertes statt fortgeschriebenes Hoch');
assertEqual(text(get('balanceMarketPreviewSource')), 'Referenz VWCE.DE · Schlusskurs 30.10.2026', 'Quelle mit Schlusskursdatum');
// Wieder aufgenommen nach dem Gutachten AR2 (Fable B4): Zusatzzeilen, Spaltenherkunft und undatiertes Hoch bestehen weiter.
for (const [view, left, right] of [[same, false, false], [phaseOnly, false, false], [different, false, true], [lower, true, true], [higher, true, true], [project({ quote: false }), false, false]]) {
    render(null); render(view);
    assertEqual(!get('balanceHighBudget').hidden, left, 'Budgetzeile nur bei Budgetunterschied: ' + view.comparison.state);
    assertEqual(!get('balanceHighAction').hidden, right, 'Aktionszeile nur bei anderer Hauptaktion: ' + view.comparison.state);
}
const sameAction = structuredClone(different); sameAction.comparison.high.mainAction = { ...sameAction.comparison.rule.mainAction };
render(sameAction); assert(get('balanceHighAction').hidden, 'Gleiche Hauptaktion trotz anderer Steuer verborgen');
sameAction.comparison.high.mainAction.netAmount += 1;
render(sameAction); assert(!get('balanceHighAction').hidden, 'Anderer Verkaufsbetrag sichtbar');
sameAction.comparison.high.mainAction = { ...sameAction.comparison.rule.mainAction, type: 'other' };
render(sameAction); assert(!get('balanceHighAction').hidden, 'Andere Hauptaktion sichtbar');
assert(text(render(project({ closed: false }))).includes('Bisherige Regel (Jahresmarktdaten Ende VJ)'), 'Ohne Abschluss: ehrliche Spaltenherkunft');
const undated = project({ equal: true }); undated.rule.high.origin = 'year_end'; undated.rule.high.asOf = null; undated.high.high.origin = 'stored_ath'; undated.high.high.asOf = null;
const undatedText = text(render(undated));
assertEqual(undatedText.split('Hoch aus Jahresmarktdaten · Datum nicht belegt').length - 1, 2, 'Undatiertes Hoch in beiden Spalten gleich');
assert(undatedText.includes('Mit Hoch (Datum nicht belegt)'), 'Kein erfundenes Hochdatum');
for (const reason of ['Kursreihe hat ungeprüfte Tage', 'letzter Schlusskurs älter als 10 Kalendertage', 'Jahresstand unklar oder nicht verfügbar']) {
    const view = structuredClone(different); view.comparison.state = 'not_reliable'; view.comparison.reason = reason;
    assert(text(render(view)).includes(reason), 'Grund bleibt sichtbar: ' + reason);
    assertEqual(tags(get('balanceMarketPreviewBody'), 'table').length, 0, 'Keine Tabelle bei nicht belastbarem Vergleich');
}
render(null); assert(get('balanceMarketPreview').hidden && !get('balanceMarketPreviewBody').children.length, 'Neuer Start entfernt alten Block');
const absent = createAnnualMarketReadings(doc, null); assert(absent.hidden && !absent.children.length, 'Vor Kursabruf kein Jahresvergleich');
const html = fs.readFileSync(new URL('../Balance.html', import.meta.url), 'utf8');
for (const label of ['nach Regel (Jahresendstände)', 'Vorläufige Empfehlung · nach Regel', 'Budgetprüfung für das nächste Jahr', 'Mehr im Handbuch', 'Handbuch.html#balance-vorschau']) assert(html.includes(label), 'Statische Beschriftung: ' + label);
const info = html.match(/id="balanceMarketPreviewInfo"[^>]*>(.*?)<a /s)[1];
assertEqual(info.trim(), 'Bereitet das nächste Jahr wie der Jahresabschluss vor – nur auf einer Kopie, ohne zu speichern – und rechnet beide Varianten. Unbekannte Werte sind Annahmen. Verbindlich ist nur der Jahresabschluss.', 'Info enthält die drei beauftragten Sätze');

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
    assert(content('balanceMarketPreviewBody').includes('170,00 €'), 'Produktiver Renderer zeigt Tageskurs im neuen Block');
    assertEqual(content('balanceMarket-endeVJ-value'), '150,00 €', 'Strategiekachel zeigt gespeicherte Jahresbasis statt Tageskurs');
    assertEqual(content('balanceMarket-ath-value'), '150,00 €', 'Herkunft und gespeichertes Hoch passen zusammen');
    assert(content('marketDataProvenance').startsWith('Jahresmarktdaten ·'), 'Gespeicherte Provenienz ausdrücklich benannt');
    assert(content('balanceMarketSource').includes('Vorschau nach Regel · VWCE.DE · Schlusskurs 30.10.2026'), 'Marktfakten bekommen die Vorschauherkunft');
    assert(document.getElementById('balanceHighAction').hidden, 'Gleiche Folgejahres-Hauptaktionen erhalten keine Zusatzzeile');
    assertEqual(content('balanceMarketPreviewTitle'), 'Budgetprüfung für 2027', 'Produktiver Renderer zeigt Folgejahr statt p25-Vorschau');
} finally {
    UIReader.planFormSource = null;
    restoreLocks(); P.resetPersistenceRuntimeForTests(); setAppTestDate(originalDate);
    for (const [key, descriptor] of Object.entries(globals)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
}
