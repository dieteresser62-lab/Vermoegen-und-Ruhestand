import { EngineAPI } from '../engine/index.mjs';
import { projectAnnualMarketReadings } from '../app/balance/balance-annual-market-preview.js';
import { createAnnualMarketReadings, renderBalanceMarketPreview } from '../app/balance/balance-market-preview-renderer.js';
import { highCheckUnreliable } from '../app/balance/balance-market-preview.js';
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
        // Abgefragt ab Historienstart wie die Referenzreihe (ATH-1b); sonst wären die Tage davor ungeprüft.
        ...emptyHistorySymbol(), currency: 'EUR', days: dates.map(historyDay), closes, queried: [[historyDay('2025-01-01'), historyDay(dates.at(-1))]]
    } } });
};
const draft = () => JSON.stringify(computeAnnualPlanUpdate({ targetYear: 2026, marketData, storage, now: annualTestNow }));
delete records[DAILY_PRICES_KEY];
// Gutachten P2-1: Ohne Tagesreihe gilt der Jahresendabruf; Marktschritt und Jahresentwurf zeigen dasselbe Hoch, keine Vorjahreswerte.
const withoutSeries = await projectAnnualMarketReadings(options), withoutSeriesDraft = JSON.parse(JSON.parse(draft()).records[key]).inputs;
assert(!withoutSeries.withoutQuote && withoutSeries.index === 170.25 && withoutSeries.quote.price === 170.25, 'Ohne Tageskurse zählt der Jahresendabruf');
assert(withoutSeries.inputs.ath === withoutSeriesDraft.ath && withoutSeries.inputs.jahreSeitAth === withoutSeriesDraft.jahreSeitAth
    && withoutSeries.inputs.endeVJ === withoutSeriesDraft.endeVJ, 'Ohne Tageskurse: Marktschritt und Jahresentwurf gleich');
assert(withoutSeries.high.origin === 'quote' && withoutSeries.high.value === 170.25, 'Ohne Tageskurse: Hoch aus gespeichertem Hoch und Abschlusskurs');
// Gutachten P3-1: Ohne Kurse ab Historienstart bleibt die Marktlage „nicht belastbar“.
assert(highCheckUnreliable(withoutSeries) && withoutSeries.unreliableReason.startsWith('Kursreihe hat ungeprüfte Tage'), 'Ohne Tageskurse keine belastbare Marktlage trotz Jahresendabruf');
assertEqual(await projectAnnualMarketReadings({ ...options, quote: undefined }), null, 'Vor Jahresendabruf kein Vergleich');
prices([140, 200, 169, 1000]);
const baseline = draft();
const before = JSON.stringify({ records, marketData });
const view = await projectAnnualMarketReadings(options);
assertEqual(view.index, 170.25, 'Index verwendet unveränderten Abrufkurs mit Nachkommastellen');
assertEqual(view.high.value, 200, 'Gesamte gespeicherte Historie bis zum Jahresendkurs zählt');
assertEqual(view.high.asOf, '2026-07-14', 'Höchster Schlusskurs behält Herkunft');
assertEqual(view.market.key, 'corr_young', 'Engine liefert die Marktlage zum Allzeithoch');
assertEqual(view.inputs.ath, JSON.parse(JSON.parse(baseline).records[key]).inputs.ath, 'Anzeige und Jahresentwurf verwenden dasselbe Hoch');
assertEqual(JSON.stringify({ records, marketData }), before, 'Anzeige verändert weder Speicher noch vorbereitete Werte');
assert(draft() === baseline, 'Übernommener Jahresentwurf bleibt nach der Anzeige bytegleich');
const doc = new MockDocument(), all = node => [node, ...node.children.flatMap(all)];
const content = node => node.textContent.replaceAll('\u00a0', ' ');
const rendered = createAnnualMarketReadings(doc, view);
// FR-89: Der Schritt Marktdaten zeigt Allzeithoch mit Datum, Abstand, Marktlage und Kursschwelle, ohne zweite Lesart.
const shown = all(rendered).map(node => content(node)).join(' | ');
assert(!rendered.hidden && shown.includes('200,00 € · Tagesschluss vom 14.07.2026') && shown.includes('Junge Korrektur') && !shown.includes('Jahresendregel'), `Jahresabschluss zeigt ein Hoch (${shown})`);
prices([170.25, 170.25], ['2026-07-14', '2026-12-31']);
const equal = await projectAnnualMarketReadings(options);
assertEqual(equal.high.origin, 'quote', 'Gleicher Schluss am Stichtag: der Jahresendkurs ist das Hoch');
prices([500, 600], ['2025-12-31', '2027-01-01']);
assertEqual((await projectAnnualMarketReadings(options)).high.value, 500, 'Früheres Hoch zählt auch ohne gespeicherten Schluss im Abschlussjahr');
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
    await doc.getElementById('annualConfirmBtn').fire('click');
    const result = await pending;
    binding.close(true);
    return JSON.stringify(result);
}
assertEqual(await prepared(async () => view, true), await prepared(async () => null), 'Bestätigung liefert mit und ohne Vergleich bytegleiche übernommene Werte');

// TN-1: Echter update()-Weg, einschließlich noch laufender und überholter Projektionen. Geprüft wird am Hinweis „nicht belastbar“,
// dass gleiche Ergebnisse den Knoten behalten und überholte nichts ersetzen.
{
    const { doc } = createDialogFixture();
    const model = { occasion: { previousYear: 2026, previousMonth: 12 }, expenses: { complete: true } };
    let binding, resolveReading;
    const unreliable = reason => ({ withoutQuote: true, withoutQuoteReason: reason, unreliableReason: reason, quote: null, yearEndDate: null });
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

// Balance: Die Kurszeile in „Was zu tun ist“ behält bei gleichem Ergebnis ihren Knoten und verschwindet mit belastbaren Kursen.
{
    const { doc } = createDialogFixture();
    for (const id of ['balanceMarketPreview', 'balanceMarketPreviewBody']) {
        const node = doc.createElement('div'); node.id = id; doc.body.append(node);
    }
    const stale = { ...structuredClone(view), unreliableReason: 'letzter Schlusskurs älter als 10 Kalendertage' };
    const host = doc.getElementById('balanceMarketPreviewBody');
    const line = () => host.querySelector('[data-high-stale]');
    renderBalanceMarketPreview(doc, stale);
    const initial = line();
    renderBalanceMarketPreview(doc, structuredClone(stale));
    assert(initial && line() === initial, 'TN-1: Balance behält bei gleichem Ergebnis die Kurszeile');
    renderBalanceMarketPreview(doc, view);
    assert(!line() && doc.getElementById('balanceMarketPreview').hidden, 'TN-1: mit belastbaren Kursen verschwindet die Zeile');
}
