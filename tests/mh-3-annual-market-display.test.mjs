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
const tags = tag => all(rendered).filter(node => node.tagName.toLowerCase() === tag);
assertEqual(tags('thead')[0].children[0].children.length, 3, 'Zwei Varianten plus Zeilenbeschriftung');
assertEqual(tags('tbody')[0].children.length, 5, 'AR-2: fünf Zeilen der Lesarten zuerst');
for (const word of ['Bisherige Regel', 'Mit Jahreshoch 14.07.2026', '170,25 €', '200,00 €', 'höchster gespeicherter Schlusskurs am 14.07.2026', '14,9 %', 'Markt heiß gelaufen', 'Junge Korrektur', 'Der Markt war in diesem Jahr schon viel heißer'])
    assert(content(rendered).includes(word), 'Jahresvergleich enthält ' + word);
prices([170.25, 170.25], ['2026-07-14', '2026-12-31']);
const equal = createAnnualMarketReadings(doc, await projectAnnualMarketReadings(options));
assert(content(equal).includes('keine Auswirkung auf die Planung'), 'Gleiche Varianten ohne Budgetwarnung');
assert(all(equal).filter(node => node.tagName === 'DETAILS').every(node => !node.open), 'Gleiche Budgets lassen Details geschlossen');
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

// TN-1: Echter update()-Weg, einschließlich noch laufender und überholter Projektionen.
{
    const { doc } = createDialogFixture();
    const model = { occasion: { previousYear: 2026, previousMonth: 12 }, expenses: { complete: true } };
    let binding, resolveReading;
    let nextView = structuredClone(view), delay = false;
    const ui = createAnnualCloseDialog({ document: doc, getModel: () => model, isCommitActive: () => false,
        projectMarketReadings: () => delay ? new Promise(resolve => { resolveReading = resolve; }) : Promise.resolve(structuredClone(nextView)),
        projectPreview: () => ({ targetYear: 2026, planningYear: 2027, people: [], needs: [] }) });
    const pending = ui.showAnnualPreparation({ targetYear: 2026, model, people: [{ id: 'a', name: 'Max Mustermann', value: 10000 }],
        onReady: handle => { binding = handle; } });
    binding.updateMarketData({ values: marketData, errors: {} });
    const settled = () => new Promise(resolve => setTimeout(resolve, 0));
    await settled();
    const details = () => ['[data-budget-comparison-details]', '[data-market-comparison-details]'].map(selector => doc.querySelector(selector));
    const initial = details(); initial.forEach(node => { node.open = true; });
    binding.update(structuredClone(model)); await settled();
    assert(details().every((node, index) => node === initial[index] && node.open), 'TN-1: gleiches Ergebnis behält beide offenen DOM-Knoten');
    nextView.rule.index += 1;
    binding.update(structuredClone(model)); await settled();
    assert(details().every((node, index) => node !== initial[index] && node.open), 'TN-1: geändertes Ergebnis erhält beide offenen Aufklapper');
    delay = true; binding.update(structuredClone(model));
    const waiting = details();
    assert(waiting.every(node => node.open), 'TN-1: laufende Projektion entfernt keine Aufklapper');
    waiting[0].open = false;
    const changed = structuredClone(nextView); changed.rule.index += 2;
    resolveReading(changed); await settled();
    assert(!details()[0].open && details()[1].open, 'TN-1: Budget geschlossen und Markt offen werden unabhängig und erst beim Ersetzen übernommen');
    binding.update(structuredClone(model)); const obsolete = resolveReading;
    binding.update(structuredClone(model)); const latest = resolveReading;
    latest(nextView); await settled();
    const current = details(); obsolete(changed); await settled();
    assert(details().every((node, index) => node === current[index]), 'TN-1: überholte Projektion ersetzt den jüngsten Vergleich nicht');
    binding.close(false); await pending;
}

// Die Balance-Budgetprüfung verwendet denselben Renderer und ersetzt ihren Inhalt ebenfalls.
{
    const { doc } = createDialogFixture();
    for (const id of ['balanceMarketPreview', 'balanceMarketPreviewBody']) {
        const node = doc.createElement('div'); node.id = id; doc.body.append(node);
    }
    const host = doc.getElementById('balanceMarketPreviewBody');
    const details = () => [host.querySelector('[data-budget-comparison-details]'), host.querySelector('[data-market-comparison-details]')];
    renderBalanceMarketPreview(doc, view);
    const initial = details(); initial.forEach(node => { node.open = true; });
    renderBalanceMarketPreview(doc, structuredClone(view));
    assert(details().every((node, index) => node === initial[index] && node.open), 'TN-1: Balance behält bei gleichem Ergebnis offene DOM-Knoten');
    const changed = structuredClone(view); changed.rule.index += 1;
    renderBalanceMarketPreview(doc, changed);
    assert(details().every((node, index) => node !== initial[index] && node.open), 'TN-1: Balance erhält beide offenen Aufklapper bei geändertem Ergebnis');
    details()[0].open = false;
    renderBalanceMarketPreview(doc, view);
    assert(!details()[0].open && details()[1].open, 'TN-1: Balance erhält auch die unabhängige geschlossene Auswahl');
}
