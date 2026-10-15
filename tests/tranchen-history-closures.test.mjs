import { projectHistoryClosures, renderManagerWealthHistory, managerHistoryLegend, dailyHistoryMetricsMarkup } from '../app/tranches/tranchen-history-closures.js';
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
const nodes = Object.fromEntries(['managerWealthChart', 'managerWealthContext', 'managerWealthMetrics', 'managerWealthTable', 'managerWealthHint', 'managerWealthCapturedTitle', 'managerWealthPersonHint', 'managerWealthLegend', 'managerWealthDailyNote', 'managerWealthBasis', 'managerWealthStatus', 'managerDailyMetrics', 'managerDailyPeriod', 'managerDailyStatus', 'managerDailyAllocation', 'managerDailyInfo'].map(id => [id, { innerHTML: '', textContent: '' }]));
const doc = { getElementById: id => nodes[id] };
const registry = { profiles: { a: { data: { [CONFIG.STORAGE.LS_KEY]: JSON.stringify(state) } }, b: { data: {} } } };
const model = { profiles: [{ id: 'a', name: 'A', history }, { id: 'b', name: 'B' }], householdHistory: history };
renderManagerWealthHistory(doc, model, registry, 'a', { kind: 'history', historyScope: 'household' });
assertEqual(nodes.managerWealthMetrics.innerHTML, summaryMarkup(projection.rows, { missingComparisonHint: 'Jahresvergleich braucht zwei erfasste Stände' }), 'Drei Kennzahlen entsprechen bestehender Abschlussaufbereitung');
assertEqual(nodes.managerWealthTable.innerHTML, tableMarkup(projection.rows), 'Tabelle erhält Beträge, Spalten und Reihenfolge');
assert(nodes.managerWealthContext.textContent.includes('unabhängig vom aktiven Profil'), 'Haushaltsstände gehören zum Haushalt unabhängig vom Profil');
assert(nodes.managerWealthTable.innerHTML.indexOf('02.01.2027') < nodes.managerWealthTable.innerHTML.indexOf('31.12.2026'), 'Neueste Stände zuerst');
assert(nodes.managerWealthMetrics.innerHTML.includes('Jahresvergleich braucht zwei erfasste Stände'), 'Jahresvergleich erklärt die fehlenden erfassten Stände unabhängig von Tageskursen');
assert(nodes.managerWealthBasis.textContent.includes('Kurve aus Beständen und Tageskursen') && nodes.managerWealthBasis.textContent.includes('Rauten aus erfassten Ständen'), 'Sichtbare Herkunft trennt berechnete Kurve und gespeicherte Stände');
renderManagerWealthHistory(doc, model, registry, 'b', { kind: 'plan' });
assertEqual(nodes.managerWealthTable.innerHTML, tableMarkup(projection.rows), 'Profilwechsel erhält alle Haushaltsstände');
assert(nodes.managerWealthChart.innerHTML.includes('history-total'), 'Haushaltsansicht erhält Tageslinie unabhängig von Abschlussständen');

assert(nodes.managerWealthMetrics.innerHTML !== '', 'Haushaltskennzahlen bleiben beim Profilwechsel erhalten');
assertEqual(nodes.managerWealthHint.textContent, '', 'Vorhandene Haushaltsstände brauchen keinen Leertext');
renderManagerWealthHistory(doc, model, registry, 'a', { kind: 'history', historyScope: 'person' });
assertEqual(nodes.managerWealthMetrics.innerHTML, '', 'Person erhält keine Haushaltskennzahlen aus erfassten Ständen');
assertEqual(nodes.managerWealthTable.innerHTML, '', 'Person erhält keine Haushaltszeilen');
assert(!nodes.managerWealthChart.innerHTML.includes('data-closure-date'), 'Person erhält keine Haushaltsrauten');
assert(nodes.managerWealthCapturedTitle.hidden && nodes.managerWealthMetrics.hidden && nodes.managerWealthTable.hidden, 'Überschrift, Kennzahlen und Tabelle sind bei Personen verborgen');
assert(!nodes.managerWealthPersonHint.hidden, 'Person sieht den Verweis auf Haushaltsstände');
assert(!nodes.managerWealthBasis.textContent.includes('Rauten'), 'Personenbasis behauptet keine erfassten Stände');
assertEqual(nodes.managerWealthHint.textContent, '', 'Person wird nicht zu vermeintlichen Personenständen aufgefordert');
nodes.managerWealthStatus.textContent = 'Vermögensstand gesichert';
renderManagerWealthHistory(doc, model, registry, 'a', { kind: 'history', historyScope: 'person' });
assertEqual(nodes.managerWealthStatus.textContent, 'Vermögensstand gesichert', 'Erfolg bleibt beim Neuzeichnen derselben Ansicht sichtbar');
renderManagerWealthHistory(doc, model, registry, 'a', { kind: 'history', historyScope: 'household' });
assertEqual(nodes.managerWealthStatus.textContent, '', 'Haushaltswechsel entfernt fremden Erfolg');
assert(nodes.managerWealthDailyNote.textContent.startsWith('Tageslinie des Haushalts'), 'Haushaltswahl zeichnet Haushaltslinie');
assert(!nodes.managerWealthCapturedTitle.hidden && !nodes.managerWealthMetrics.hidden && !nodes.managerWealthTable.hidden && nodes.managerWealthPersonHint.hidden, 'Rückkehr zum Haushalt stellt bisherige Standanzeige wieder her');
assertEqual(nodes.managerWealthTable.innerHTML, tableMarkup(projection.rows), 'Haushaltsanzeige bleibt nach Personenwechsel unverändert');

const croppedLegend = managerHistoryLegend(history);
assert(croppedLegend.includes('Gesamtvermögen') && !croppedLegend.includes('history-cash'), 'Gesamtfläche bei positiver Untergrenze zeigt keine Anlagefarben');
assert(!croppedLegend.includes('Jahresabschluss') && !croppedLegend.includes('Unterjährig') && !croppedLegend.includes('Kauf') && !croppedLegend.includes('Verkauf'), 'Nicht gezeichnete Marken fehlen in Legende');
assert(managerHistoryLegend(projection.chart).includes('history-cash'), 'Abschlusswerte in Skalenbasis können die sichtbare Stapelung ermöglichen');
const markersLegend = managerHistoryLegend(alone.chart);
assert(markersLegend.includes('Jahresabschluss') && markersLegend.includes('Unterjährig') && !markersLegend.includes('Gesamtvermögen'), 'Stände ohne Kurve erklären nur gezeichnete Rauten');
const visible = { ...history, types: ['cash', 'gold'], points: [{ ...history.points[0], total: 0, allocation: { cash: 0, gold: 0 } },
    { ...history.points[0], day: day + 1, total: 80, allocation: { cash: 80, gold: 0 } }],
    events: [{ kind: 'buy', day: day + 1 }, { kind: 'sell', day: day + 2 }], gaps: [[day, day]] };
const visibleLegend = managerHistoryLegend(visible);
assert(visibleLegend.includes('history-cash') && !visibleLegend.includes('history-gold'), 'Nur Anlageflächen mit sichtbarem Betrag stehen in Legende');
assert(visibleLegend.includes('Kauf') && !visibleLegend.includes('Verkauf') && visibleLegend.includes('Ungeprüfte Werktage'), 'Legende zeigt nur bewertbar gezeichnete Ereignisse und vorhandene Schraffur');
assertEqual(managerHistoryLegend(null), '', 'Kein Diagramm erhält keine Legende');
renderManagerWealthHistory(doc, { profiles: [{ id: 'a', name: 'A' }] }, registry, 'a', { kind: 'history', historyScope: 'household' });
assert(nodes.managerWealthBasis.textContent.startsWith('Keine bewertbare Tageskurve'), 'Marken ohne Kurse behaupten keine berechnete Tageskurve');
renderManagerWealthHistory(doc, { profiles: [{ id: 'b', name: 'B' }] }, registry, 'b', { kind: 'history', historyScope: 'person' });
assertEqual(nodes.managerWealthBasis.textContent, '', 'Leere Auswahl entfernt fremde Datenbasis');
assertEqual(nodes.managerWealthLegend.innerHTML, '', 'Leere Auswahl entfernt fremde Legende');
assertEqual(JSON.stringify([state, history]), before, 'Neue Erklärung und Legende ändern keine Datenquellen');

// Die verschobenen Kennzahlen behalten dieselbe Tagesbewertung, auch bei abweichenden erfassten Ständen.
const { evaluateWealthHistory } = await import('../app/tranches/tranchen-history-model.js');
const start = historyDay('2026-01-01');
const daily = evaluateWealthHistory({ startDate: '2026-01-01', today: '2026-01-07',
    profiles: [{ id: 'a', currentCash: 100, cashHistory: { version: 1, baselineValue: 100, entries: [] },
        lots: [{ trancheId: 'holiday', purchaseDate: '2025-12-15', shares: 10, purchasePrice: 200, type: 'anleihe', ticker: 'BOND', name: 'Mustermann' }] }],
    prices: { symbols: { BOND: { currency: 'EUR', days: [start + 1, start + 4, start + 5], closes: [100, 120, 110], queried: [[start, start + 5]] } } } });
frozen(daily);
const values = html => [...html.matchAll(/class="expenses-card-value[^"]*">([^<]+)</g)].map(match => match[1].replace(/\s+/g, ' ').trim());
assertEqual(JSON.stringify(values(dailyHistoryMetricsMarkup(daily))), JSON.stringify(['+100 €', '0 €', '+100 €', '1.300 €', '−7,7 %']), 'Alle fünf verschobenen Feiertagskennzahlen bleiben exakt');
const dailyModel = { profiles: [{ id: 'a', name: 'Max Mustermann', history: daily }, { id: 'b', name: 'Erika Mustermann' }], householdHistory: daily };
renderManagerWealthHistory(doc, dailyModel, registry, 'a', { kind: 'history', historyScope: 'household' });
assert(nodes.managerDailyPeriod.innerHTML.includes('02.01.2026 · vorläufig') && nodes.managerDailyPeriod.innerHTML.includes('06.01.2026'), 'Eigene Tagesgruppe nennt Messbeginn, Status und Endtag');
assert(!nodes.managerDailyPeriod.innerHTML.includes('2027'), 'Erfasste Stände erweitern niemals den Kennzahlenzeitraum');
assert(nodes.managerDailyAllocation.innerHTML.includes('06.01.2026') && nodes.managerDailyAllocation.innerHTML.includes('1.100'), 'Aufteilung nennt den tatsächlichen Tagesendbetrag');
assert(nodes.managerDailyInfo.innerHTML.includes('Transfers') && nodes.managerDailyInfo.innerHTML.includes('keine Renditeberechnung') && nodes.managerDailyInfo.innerHTML.includes('rückwirkend angenommen'), 'Vollständige Lesehilfe und Basisannahme im vorhandenen Infofeld');
const dailyBytes = JSON.stringify(dailyModel);
renderManagerWealthHistory(doc, dailyModel, registry, 'b', { kind: 'history', historyScope: 'person' });
assertEqual(nodes.managerDailyAllocation.innerHTML, '', 'Person ohne Verlauf behält keine fremde Aufteilung');
assert(nodes.managerDailyStatus.textContent.includes('Noch keine') && values(nodes.managerDailyMetrics.innerHTML).every(value => value === '—'), 'Fehlende Tageshistorie zeigt keine erfundenen Nullen');
assertEqual(JSON.stringify(dailyModel), dailyBytes, 'Haushalts-/Personenwechsel verändert keine Tagesquelle');
for (const missing of [false, true]) {
    const cash = evaluateWealthHistory({ startDate: '2026-01-01', today: '2026-01-04', profiles: [
        { id: 'a', currentCash: 80, lots: [], cashHistory: missing ? null : { version: 1, baselineValue: 100, entries: [{ date: '2026-01-02', value: 80 }] } },
        { id: 'b', currentCash: 50, lots: [] }] });
    assertEqual(values(dailyHistoryMetricsMarkup(cash))[1], missing ? '0 €' : '20 €', 'Entnahmen behalten Haushaltsbeiträge trotz fehlender Cashhistorie');
}

// Muster-Haushalt: unterschiedliche Profilkopien derselben Haushaltserfassung,
// Altformat ohne Umfangskennung im schon früher genutzten v29-Schlüssel und
// unter dem alten Snapshotpräfix; beide bleiben rein lesend erhalten.
const { projectProfileWealthHistory } = await import('../app/profile/profile-wealth-history.js');
const { prepareWealthHistoryMetrics } = await import('../app/balance/balance-wealth-history-metrics.js');
const { loadStoredBalanceStateFromData } = await import('../app/profile/profile-state.js');
const oldFirst = createManualWealthHistoryEntry({ tagesgeld: 7300, geldmarktEtf: 4200, depotwertAlt: 6200, depotwertNeu: 8100 }, '2026-03-03');
const oldLast = createManualWealthHistoryEntry({ tagesgeld: 7100, geldmarktEtf: 4200, depotwertAlt: 6500, depotwertNeu: 8400 }, '2026-03-06');
const oldStates = [[oldFirst, oldLast], [{ ...oldFirst, tagesgeld: 7200, total: oldFirst.total - 100 }]];
const sampleRegistry = { version: 1, profiles: Object.fromEntries(['a', 'b'].map((id, index) => [id, { meta: { id, name: index ? 'Erika Mustermann' : 'Max Mustermann' }, data: {
    [CONFIG.STORAGE.LS_KEY]: JSON.stringify({ inputs: {}, wealthHistory: { schemaVersion: 1, entries: oldStates[index] } }),
    ruhestandsmodell_snapshot_alt: JSON.stringify({ inputs: {}, wealthHistory: { schemaVersion: 1, entries: [oldFirst] } }),
    profile_tagesgeld: index ? '300' : '7000', depot_tranchen: '[]',
    profile_cash_history_v1: JSON.stringify({ version: 1, baselineValue: index ? 300 : 7000, entries: [] })
} }])) };
const people = [{ id: 'a', name: 'Max Mustermann', valid: true, belongs: true, values: { tagesgeld: 7000 } },
    { id: 'b', name: 'Erika Mustermann', valid: true, belongs: true, values: { tagesgeld: 300 } }];
const sampleContext = { status: 'ready', startDate: '2026-03-01', today: '2026-03-08', prices: { symbols: {} } };
for (const person of people) person.history = projectProfileWealthHistory(sampleRegistry, people, { ...sampleContext, profileId: person.id });
const sampleModel = { profiles: people, householdHistory: projectProfileWealthHistory(sampleRegistry, people, sampleContext), historyContext: sampleContext };
frozen(sampleRegistry); frozen(sampleModel);
const sampleBytes = JSON.stringify([sampleRegistry, sampleModel]);
const stableSvg = svg => svg.replace(/wealth-history-\d+/g, 'wealth-history-test');
for (const id of ['a', 'b']) {
    renderManagerWealthHistory(doc, sampleModel, sampleRegistry, id, { kind: 'history', historyScope: 'household' });
    const loaded = loadStoredBalanceStateFromData(sampleRegistry.profiles[id].data).value;
    const { projectWealthCaptures } = await import('../app/profile/profile-wealth-captures.js');
    const expected = projectHistoryClosures(sampleModel.householdHistory, projectWealthCaptures(sampleRegistry, null));
    const householdSvg = nodes.managerWealthChart.innerHTML;
    assertEqual(nodes.managerWealthTable.innerHTML, tableMarkup(expected.rows), 'Altbestand: Haushaltszeilen bleiben exakt wie bisher');
    assertEqual(nodes.managerWealthMetrics.innerHTML, summaryMarkup(expected.rows, { missingComparisonHint: 'Jahresvergleich braucht zwei erfasste Stände' }), 'Altbestand: Haushaltskennzahlen bleiben exakt wie bisher');
    assertEqual(stableSvg(householdSvg), stableSvg(renderWealthHistorySvg(expected.chart)), 'Altbestand: Haushaltsskala und Rauten bleiben exakt wie bisher');
    const expectedDaily = dailyHistoryMetricsMarkup(people.find(person => person.id === id).history);
    renderManagerWealthHistory(doc, sampleModel, sampleRegistry, id, { kind: 'history', historyScope: 'person' });
    const personSvg = nodes.managerWealthChart.innerHTML;
    assert(!personSvg.includes('data-closure-date'), 'Auch abweichender Altbestand erscheint nie als Personenraute');
    assertEqual(nodes.managerWealthMetrics.innerHTML + nodes.managerWealthTable.innerHTML, '', 'Beide Personen ohne Haushaltskennzahlen und Tabellenzeilen');
    const person = people.find(person => person.id === id);
    const pureSvg = renderWealthHistorySvg(projectHistoryClosures(person.history, {}).chart);
    for (const field of ['floor', 'ceiling']) assertEqual(personSvg.match(new RegExp(`data-scale-${field}="([^"]+)"`))[1], pureSvg.match(new RegExp(`data-scale-${field}="([^"]+)"`))[1], 'Personenachse entsteht ausschließlich aus Personenwerten');
    assertEqual(nodes.managerDailyMetrics.innerHTML, expectedDaily, 'Tageskennzahlen beider Personen bleiben erhalten');
    assertEqual(JSON.stringify(prepareWealthHistoryMetrics(loaded).map(row => row.total)), JSON.stringify(oldStates[id === 'a' ? 0 : 1].map(row => row.total)), 'Ausgeblendete Altstände bleiben unverändert lesbar');
    renderManagerWealthHistory(doc, sampleModel, sampleRegistry, id, { kind: 'history', historyScope: 'household' });
    assertEqual(stableSvg(nodes.managerWealthChart.innerHTML), stableSvg(householdSvg), 'Rückkehr stellt Haushaltsgrafik unverändert wieder her');
}
assertEqual(JSON.stringify([sampleRegistry, sampleModel]), sampleBytes, 'Alle Profil-, Alt- und Sicherungsrecords bleiben bytegleich');

// Neue Personenstände verwenden eigene Rauten, Kennzahlen, Tabelle und Achse.
const own = createManualWealthHistoryEntry({ tagesgeld: 110, geldmarktEtf: 20, depotwertAlt: 30, depotwertNeu: 40 }, '2027-01-03');
const ownA = { ...own, goldWert: 10, anleihen: 15, total: own.total + 25 };
const ownB = { ...ownA, tagesgeld: 11, total: ownA.total - 99 };
const householdEntry = Object.fromEntries(Object.entries(ownA).map(([key, value]) => [key, typeof value === 'number' ? value + ownB[key] : value]));
const captureRaw = JSON.stringify({ schemaVersion: 1, captures: [{ capturedAt: '2027-01-03T12:00:00Z', household: householdEntry, people: { a: ownA, b: ownB } }] });
const storage = { getItem: () => captureRaw };
for (const [id, entry] of [['a', ownA], ['b', ownB]]) {
    renderManagerWealthHistory(doc, model, registry, id, { kind: 'history', historyScope: 'person' }, storage);
    const expected = projectHistoryClosures(model.profiles.find(person => person.id === id).history, { wealthHistory: { schemaVersion: 1, entries: [entry] } });
    assertEqual(nodes.managerWealthMetrics.innerHTML, summaryMarkup(expected.rows, { missingComparisonHint: 'Jahresvergleich braucht zwei erfasste Stände' }), 'Personenkennzahlen entsprechen ausschließlich dem eigenen Stand');
    assertEqual(nodes.managerWealthTable.innerHTML, tableMarkup(expected.rows), 'Personentabelle enthält eigenen Stand einschließlich Gold und Anleihen');
    assert(nodes.managerWealthChart.innerHTML.includes('data-closure-date="2027-01-03"'), 'Eigenes Erfassen erscheint als Personenraute');
    assertEqual(stableSvg(nodes.managerWealthChart.innerHTML), stableSvg(renderWealthHistorySvg(expected.chart)), 'Personenachse verwendet nur eigene Tages- und erfasste Werte');
    assert(!nodes.managerWealthMetrics.hidden && !nodes.managerWealthTable.hidden, 'Personen mit eigenen Ständen zeigen Kennzahlen und Tabelle');
}
renderManagerWealthHistory(doc, model, registry, 'b', { kind: 'history', historyScope: 'household' }, storage);
assert(nodes.managerWealthTable.innerHTML.includes('03.01.2027') && nodes.managerWealthTable.innerHTML.includes('02.01.2027'), 'Haushalt zeigt auch nach Profilwechsel neue und alte Stände zusammen');
