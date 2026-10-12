import { projectHistoryClosures, renderManagerWealthHistory } from '../app/tranches/tranchen-history-closures.js';
import { renderWealthHistorySvg } from '../app/tranches/tranchen-history-svg.js';
import { historyDay } from '../app/tranches/tranchen-history-store.js';
import { createManualWealthHistoryEntry, createAnnualWealthHistoryEntry } from '../types/wealth-history-contract.js';
import { summaryMarkup, tableMarkup } from '../app/balance/balance-wealth-history-renderer.js';
import { CONFIG } from '../app/balance/balance-config.js';

const source = { tagesgeld: 100, geldmarktEtf: 200, depotwertAlt: 300, depotwertNeu: 400 };
const annual = createAnnualWealthHistoryEntry(source, 2026);
const manual = createManualWealthHistoryEntry({ ...source, tagesgeld: 2000 }, '2027-01-02');
const state = { wealthHistory: { schemaVersion: 1, entries: [manual, annual] } };
const day = historyDay('2027-01-01');
const history = { points: [{ date: '2027-01-01', day, total: 80, known: 80, allocation: { cash: 80 }, quality: [] }],
    types: ['cash'], events: [], gaps: [], range: { start: day, end: day } };
const frozen = value => { Object.freeze(value); for (const child of Object.values(value)) if (child && typeof child === 'object') frozen(child); return value; };
frozen(state); frozen(history);
const before = JSON.stringify([state, history]);
const projection = projectHistoryClosures(history, state);
assertEqual(projection.chart.points, history.points, 'Tagesreihe bleibt dieselbe unveränderte Quelle');
assertEqual(projection.chart.range.end, historyDay(manual.asOf), 'Heutiger Stand erweitert Achse über gestern hinaus');
assertEqual(projection.chart.range.start, historyDay(annual.asOf), 'Früher Abschluss erweitert Datumsachse');
const svg = renderWealthHistorySvg(projection.chart);
for (const entry of [annual, manual]) {
    assert(svg.includes(`data-closure-date="${entry.asOf}" data-closure-total="${entry.total}"`), 'Marke am gespeicherten Stichtag mit unveränderter Summe');
    assert(svg.includes(entry.asOf.split('-').reverse().join('.') + ':') && svg.includes('Summe'), 'Tooltip nennt Datum und Summe');
}
assert(svg.includes('history-closure-annual') && svg.includes('history-closure-manual'), 'Gefüllte und offene Raute haben getrennte Darstellung');
assert(Number(svg.match(/data-scale-ceiling="([^"]+)"/)[1]) > manual.total, 'Achse enthält abweichenden Abschlusswert vollständig');
assertEqual(projection.rows.map(row => row.marker).join(','), '◆,◇', 'Jahresmarker ist gefüllte Raute');
assertEqual(JSON.stringify([state, history]), before, 'Anzeige verändert keine Quelle');
const alone = projectHistoryClosures(null, state);
assertEqual(alone.chart.points.length, 0, 'Ohne Tageslinie werden keine Tageswerte erfunden');
assert(!renderWealthHistorySvg(alone.chart).includes('class="history-total"'), 'Marken allein zeichnen keine Tageslinie');
assertEqual(projectHistoryClosures(null, {}).chart, null, 'Leerer Bestand bleibt leer');
const nodes = Object.fromEntries(['managerWealthChart', 'managerWealthContext', 'managerWealthMetrics', 'managerWealthTable', 'managerWealthHint', 'managerWealthLegend', 'managerWealthDailyNote', 'managerWealthStatus'].map(id => [id, { innerHTML: '', textContent: '' }]));
const doc = { getElementById: id => nodes[id] };
const registry = { profiles: { a: { data: { [CONFIG.STORAGE.LS_KEY]: JSON.stringify(state) } }, b: { data: {} } } };
const model = { profiles: [{ id: 'a', name: 'A', history }, { id: 'b', name: 'B' }], householdHistory: history };
renderManagerWealthHistory(doc, model, registry, 'a', { kind: 'person' });
assertEqual(nodes.managerWealthMetrics.innerHTML, summaryMarkup(projection.rows), 'Drei Kennzahlen entsprechen bestehender Abschlussaufbereitung');
assertEqual(nodes.managerWealthTable.innerHTML, tableMarkup(projection.rows), 'Tabelle erhält Beträge, Spalten und Reihenfolge');
assert(nodes.managerWealthContext.textContent.includes('bei A gespeichert'), 'Historische Zuordnung behauptet keinen heutigen Personenumfang');
assert(nodes.managerWealthTable.innerHTML.indexOf('02.01.2027') < nodes.managerWealthTable.innerHTML.indexOf('31.12.2026'), 'Neueste Stände zuerst');
assert(nodes.managerWealthMetrics.innerHTML.includes('Kein zweiter Stand im Jahr'), 'Kein erfundener Jahresvergleich');
renderManagerWealthHistory(doc, model, registry, 'b', { kind: 'plan' });
assertEqual(nodes.managerWealthTable.innerHTML, '', 'Profilwechsel entfernt fremde Abschlussstände');
assert(nodes.managerWealthChart.innerHTML.includes('history-total'), 'Haushaltsansicht erhält Tageslinie unabhängig von Abschlussständen');

assert(nodes.managerWealthMetrics.innerHTML === '', 'Person ohne Stände erhält keine fremden Kennzahlen');
assertEqual(nodes.managerWealthHint.textContent, 'Noch keine Stände erfasst. Mit „Stand jetzt erfassen“ legst du den ersten an.', 'Leertext duzt');
renderManagerWealthHistory(doc, model, registry, 'a', { kind: 'history', historyScope: 'person' });
assert(nodes.managerWealthMetrics.innerHTML.includes('Zuletzt erfasst'), 'Kennzahl benennt den gespeicherten Stand');
nodes.managerWealthStatus.textContent = 'Vermögensstand gesichert';
renderManagerWealthHistory(doc, model, registry, 'a', { kind: 'history', historyScope: 'person' });
assertEqual(nodes.managerWealthStatus.textContent, 'Vermögensstand gesichert', 'Erfolg bleibt beim Neuzeichnen derselben Ansicht sichtbar');
renderManagerWealthHistory(doc, model, registry, 'a', { kind: 'history', historyScope: 'household' });
assertEqual(nodes.managerWealthStatus.textContent, '', 'Haushaltswechsel entfernt fremden Erfolg');
assert(nodes.managerWealthDailyNote.textContent.startsWith('Tageslinie des Haushalts'), 'Haushaltswahl zeichnet Haushaltslinie');
