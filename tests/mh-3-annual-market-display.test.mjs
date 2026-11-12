import { EngineAPI } from '../engine/index.mjs';
import { projectAnnualMarketReadings } from '../app/balance/balance-annual-market-preview.js';
import { createAnnualMarketReadings, renderBalanceMarketPreview } from '../app/balance/balance-market-preview-renderer.js';
import { computeAnnualPlanUpdate } from '../app/balance/balance-annual-storage.js';
import { createAnnualCloseDialog } from '../app/shared/annual-close-dialog.js';
import { createDialogFixture, prepareCloseFixture } from './close-dialog.test.mjs?fixture';
import { createMusterHaushaltRecords } from '../app/demo/muster-haushalt.js';
import { emptyHistorySymbol, historyDay, DAILY_PRICES_KEY } from '../app/tranches/tranchen-history-store.js';
import { annualTestMarketData, annualTestNow } from './helpers/balance-storage-fixtures.mjs';
import { MockDocument } from './helpers/balance-page-fixture.mjs';

const records = createMusterHaushaltRecords('2026-12-15');
const key = 'ruhestandsmodellValues_v29_guardrails';
const registry = JSON.parse(records.rs_profiles_v1);
const inputs = { endeVJ: 150, endeVJ_1: 140, endeVJ_2: 120, endeVJ_3: 110, ath: 150, jahreSeitAth: 0 };
for (const profile of Object.values(registry.profiles)) {
    const state = JSON.parse(profile.data[key]);
    state.inputs = { ...state.inputs, ...inputs };
    state.profilverbundHouseholdInputs = { ...state.profilverbundHouseholdInputs, ...inputs };
    for (const [id, value] of Object.entries(inputs)) (state.balanceInputFields ||= {})[id] = { value: String(value), checked: false };
    profile.data[key] = JSON.stringify(state);
}
records.rs_profiles_v1 = JSON.stringify(registry);
records[key] = registry.profiles[records.rs_current_profile].data[key];
const storage = { getItem: key => records[key] ?? null, key: index => Object.keys(records)[index] ?? null, get length() { return Object.keys(records).length; } };
const marketData = { ...annualTestMarketData, etf: { ...annualTestMarketData.etf, price: 170.25 } };
const options = { targetYear: 2026, quote: marketData.etf, storage, engineLoader: { load: async () => EngineAPI } };
const prices = (closes, dates = ['2025-12-31', '2026-07-14', '2026-12-30', '2027-01-01']) => {
    records[DAILY_PRICES_KEY] = JSON.stringify({ version: 1, symbols: { 'VWCE.DE': {
        ...emptyHistorySymbol(), currency: 'EUR', days: dates.map(historyDay), closes, queried: [[historyDay(dates[0]), historyDay(dates.at(-1))]]
    } } });
};
const draft = () => JSON.stringify(computeAnnualPlanUpdate({ targetYear: 2026, marketData, storage, now: annualTestNow }));
delete records[DAILY_PRICES_KEY];
assertEqual((await projectAnnualMarketReadings(options)).comparison.state, 'not_reliable', 'Ohne Tageskurse kein belastbarer Vergleich trotz Jahresendabruf');
assertEqual(await projectAnnualMarketReadings({ ...options, quote: undefined }), null, 'Vor Jahresendabruf kein Vergleich');
prices([140, 200, 169, 1000]);
const baseline = draft();
const before = JSON.stringify({ records, marketData });
const view = await projectAnnualMarketReadings(options);
assertEqual(view.rule.index, 170.25, 'Index verwendet unveränderten Abrufkurs mit Nachkommastellen');
assertEqual(view.rule.high.value, 170.25, 'Regelhoch entspricht Jahresabschluss');
assertEqual(view.high.high.value, 200, 'Gesamte gespeicherte Historie bis zum Jahresendkurs zählt');
assertEqual(view.high.high.asOf, '2026-07-14', 'Höchster Schlusskurs behält Herkunft');
assertEqual(view.rule.market.key, 'peak_hot', 'Engine liefert Regelphase');
assertEqual(view.high.market.key, 'corr_young', 'Engine liefert zweite Phase');
assertEqual(JSON.stringify({ records, marketData }), before, 'Vergleich verändert weder Speicher noch vorbereitete Werte');
assert(draft() === baseline, 'Übernommener Jahresentwurf bleibt nach Vergleich bytegleich');
const doc = new MockDocument(), all = node => [node, ...node.children.flatMap(all)];
const content = node => node.textContent.replaceAll('\u00a0', ' ');
const rendered = createAnnualMarketReadings(doc, view);
// WT-1 (FR-77 Punkt 5): Junge Korrektur am Jahreshoch ist kein verdeckter Bärenmarkt; der Schritt Marktdaten zeigt nichts zum Jahreshoch.
assert(rendered.hidden && !rendered.children.length, 'Kein verdeckter Bär: keine Lesarten-Tabelle im Jahresabschluss');
prices([170.25, 170.25], ['2026-07-14', '2026-12-31']);
const equal = createAnnualMarketReadings(doc, await projectAnnualMarketReadings(options));
assert(equal.hidden && !content(equal).includes('Nahe am Jahreshoch'), 'Gleiche Varianten zeigen nichts');
prices([500, 600], ['2025-12-31', '2027-01-01']);
assertEqual((await projectAnnualMarketReadings(options)).high.high.value, 500, 'Früheres Hoch zählt auch ohne gespeicherten Schluss im Abschlussjahr');
const absent = createAnnualMarketReadings(doc, null);
assert(absent.hidden && !absent.children.length, 'Ohne Kurs kein sichtbarer Text');

// Gemeinsamer produktiver Dialog: Kursschritt und schreibfreier Rückgabevertrag.
async function prepared(projectMarketReadings, visible = false) {
    const { doc } = createDialogFixture();
    let binding;
    const model = { occasion: { previousYear: 2026, previousMonth: 12 }, expenses: { complete: true } };
    const ui = createAnnualCloseDialog({ document: doc, getModel: () => model, isCommitActive: () => false,
        projectMarketReadings, projectPreview: () => ({ targetYear: 2026, planningYear: 2027, people: [], needs: [] }) });
    const pending = ui.showAnnualPreparation({ targetYear: 2026, model, people: [{ id: 'a', name: 'Max Mustermann', value: 10000 }],
        onReady: handle => { binding = handle; } });
    binding.updateMarketData({ values: marketData, errors: {} });
    await new Promise(resolve => setTimeout(resolve, 0));
    const host = doc.getElementById('balanceAnnualClose');
    if (visible) assert(host.querySelector('[data-close-dialog-step="market"]').querySelector('[data-annual-market-readings]'), 'Vergleich im Marktdatenschritt der gemeinsamen Abschlusskette');
    await prepareCloseFixture(doc);
    const choice = doc.querySelector('[data-annual-market-reading=\"year_end\"]');
    if (choice) { choice.checked = true; await choice.fire('change'); }
    await doc.getElementById('annualConfirmBtn').fire('click');
    const result = await pending;
    binding.close(true);
    return JSON.stringify(result);
}
assertEqual(await prepared(async () => view, true), await prepared(async () => null), 'Bestätigung liefert mit und ohne Vergleich bytegleiche übernommene Werte');

// TN-1: Echter update()-Weg, einschließlich noch laufender und überholter Projektionen. Seit WT-1 steht im Schritt Marktdaten
// nur noch der Hinweis „nicht belastbar“; geprüft wird, dass gleiche Ergebnisse den Knoten behalten und überholte nichts ersetzen.
{
    const { doc } = createDialogFixture();
    const model = { occasion: { previousYear: 2026, previousMonth: 12 }, expenses: { complete: true } };
    let binding, resolveReading;
    const unreliable = reason => ({ withoutQuote: true, withoutQuoteReason: reason, quote: null, yearEndDate: null, readingsEqual: true,
        comparison: { state: 'not_reliable', text: 'Vergleich nicht belastbar verfügbar', reason, rule: null, high: null, difference: null, changedParts: [] } });
    let nextView = unreliable('Kurse fehlen'), delay = false;
    const ui = createAnnualCloseDialog({ document: doc, getModel: () => model, isCommitActive: () => false,
        projectMarketReadings: () => delay ? new Promise(resolve => { resolveReading = resolve; }) : Promise.resolve(structuredClone(nextView)),
        projectPreview: () => ({ targetYear: 2026, planningYear: 2027, people: [], needs: [] }) });
    const pending = ui.showAnnualPreparation({ targetYear: 2026, model, people: [{ id: 'a', name: 'Max Mustermann', value: 10000 }],
        onReady: handle => { binding = handle; } });
    binding.updateMarketData({ values: marketData, errors: {} });
    const settled = () => new Promise(resolve => setTimeout(resolve, 0));
    await settled();
    const node = () => doc.querySelector('[data-annual-market-readings]');
    const deep = element => all(element).map(item => item.textContent).join(' ');
    const initial = node();
    assert(initial && !initial.hidden && deep(initial).includes('Kurse fehlen'), 'TN-1: fehlende Kurse stehen als Hinweis im Schritt Marktdaten');
    binding.update(structuredClone(model)); await settled();
    assert(node() === initial, 'TN-1: gleiches Ergebnis behält den DOM-Knoten');
    nextView = unreliable('Kurse lückenhaft');
    binding.update(structuredClone(model)); await settled();
    assert(node() !== initial && deep(node()).includes('Kurse lückenhaft'), 'TN-1: geändertes Ergebnis ersetzt den Hinweis');
    delay = true;
    binding.update(structuredClone(model)); const obsolete = resolveReading;
    binding.update(structuredClone(model)); const latest = resolveReading;
    latest(nextView); await settled();
    const current = node(); obsolete(unreliable('veraltet')); await settled();
    assert(node() === current, 'TN-1: überholte Projektion ersetzt den jüngsten Vergleich nicht');
    binding.close(false); await pending;
}

// Balance: Beim verdeckten Bärenmarkt behält der Kursverlauf seine Auswahl über gleiche und geänderte Ergebnisse.
{
    const { doc } = createDialogFixture();
    for (const id of ['balanceMarketPreview', 'balanceMarketPreviewBody']) {
        const node = doc.createElement('div'); node.id = id; doc.body.append(node);
    }
    const bear = structuredClone(view); bear.high.market = { key: 'bear_deep', text: 'Tiefer Bär' };
    const host = doc.getElementById('balanceMarketPreviewBody');
    const history = () => host.querySelector('[data-market-history-details]');
    renderBalanceMarketPreview(doc, bear);
    const initial = history(); initial.open = true;
    renderBalanceMarketPreview(doc, structuredClone(bear));
    assert(history() === initial && history().open, 'TN-1: Balance behält bei gleichem Ergebnis den offenen Kursverlauf');
    const changed = structuredClone(bear); changed.rule.index += 1;
    renderBalanceMarketPreview(doc, changed);
    assert(history() !== initial && history().open, 'TN-1: Balance erhält den offenen Kursverlauf bei geändertem Ergebnis');
    renderBalanceMarketPreview(doc, view);
    assert(!history() && doc.getElementById('balanceMarketPreview').hidden, 'TN-1: ohne verdeckten Bären verschwindet der Block');
}
