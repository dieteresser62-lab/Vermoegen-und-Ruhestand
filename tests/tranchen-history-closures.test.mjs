import { renderManagerWealthHistory, managerHistoryLegend, dailyHistoryMetricsMarkup } from '../app/tranches/tranchen-history-closures.js';
import { renderWealthHistorySvg, historyDayRows } from '../app/tranches/tranchen-history-svg.js';
import { historyDay } from '../app/tranches/tranchen-history-store.js';
import { createManualWealthHistoryEntry, createAnnualWealthHistoryEntry } from '../types/wealth-history-contract.js';
import { WEALTH_CAPTURES_KEY } from '../types/wealth-capture-contract.js';
import { CONFIG } from '../app/balance/balance-config.js';

// VS-2: Personen & Vermögen › Verlauf zeigt keine erfassten Stände mehr. Gespeicherte Erfassungen bleiben
// unverändert im Speicher, erscheinen aber weder als Raute noch als Kennzahl, Tabelle oder Legende.
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
const nodes = Object.fromEntries(['managerWealthChart', 'managerWealthContext', 'managerWealthLegend', 'managerWealthDailyNote', 'managerWealthBasis', 'managerDailyMetrics', 'managerDailyPeriod', 'managerDailyStatus', 'managerDailyInfo'].map(id => [id, { innerHTML: '', textContent: '' }]));
const doc = { getElementById: id => nodes[id] };
const captureRaw = JSON.stringify({ schemaVersion: 1, captures: [{ capturedAt: '2027-01-02T12:00:00Z', household: manual, people: { a: manual } }] });
const registry = { profiles: { a: { data: { [CONFIG.STORAGE.LS_KEY]: JSON.stringify(state), [WEALTH_CAPTURES_KEY]: captureRaw } }, b: { data: {} } } };
const model = { profiles: [{ id: 'a', name: 'A', history }, { id: 'b', name: 'B' }], householdHistory: history };
for (const view of [{ kind: 'history', historyScope: 'household' }, { kind: 'plan' }, { kind: 'history', historyScope: 'person' }]) {
    renderManagerWealthHistory(doc, model, registry, 'a', view);
    const svg = nodes.managerWealthChart.innerHTML;
    assert(svg.includes('history-total'), 'Tageslinie bleibt sichtbar: ' + JSON.stringify(view));
    assert(!svg.includes('data-closure-date') && !svg.includes('history-closure'), 'Keine Rauten aus erfassten Ständen: ' + JSON.stringify(view));
    assertEqual(nodes.managerWealthBasis.textContent, 'Kurve aus Beständen und Tageskursen', 'Herkunft nennt nur die Kurve: ' + JSON.stringify(view));
    assert(!nodes.managerWealthLegend.innerHTML.includes('Jahresabschluss') && !nodes.managerWealthLegend.innerHTML.includes('Unterjährig'), 'Legende erklärt keine Rauten mehr');
    assertEqual(svg.replace(/wealth-history-\d+/g, 'x'), renderWealthHistorySvg(history).replace(/wealth-history-\d+/g, 'x'), 'Diagramm entsteht allein aus der Tagesprojektion');
}
assertEqual(nodes.managerWealthContext.textContent, 'Vermögensverlauf A', 'Personenansicht nennt die Person ohne Hinweis auf Haushaltsstände');
renderManagerWealthHistory(doc, model, registry, 'a', { kind: 'history', historyScope: 'household' });
assertEqual(nodes.managerWealthContext.textContent, '', 'Haushalt ohne Zusatzsatz zu abweichenden Ständen');
assertEqual(nodes.managerWealthDailyNote.textContent, '', 'Haushaltslinie wiederholt keine Erklärung aus dem kurzen ⓘ');

const croppedLegend = managerHistoryLegend(history);
assert(croppedLegend.includes('Geldvermögen') && !croppedLegend.includes('history-cash'), 'Gesamtfläche bei positiver Untergrenze zeigt keine Anlagefarben');
assert(!croppedLegend.includes('Kauf') && !croppedLegend.includes('Verkauf'), 'Nicht gezeichnete Marken fehlen in Legende');
const visible = { ...history, types: ['cash', 'gold'], points: [{ ...history.points[0], total: 0, allocation: { cash: 0, gold: 0 } },
    { ...history.points[0], day: day + 1, total: 80, allocation: { cash: 80, gold: 0 } }],
    events: [{ kind: 'buy', day: day + 1 }, { kind: 'sell', day: day + 2 }], gaps: [[day, day]] };
const visibleLegend = managerHistoryLegend(visible);
assert(visibleLegend.includes('history-cash') && !visibleLegend.includes('history-gold'), 'Nur Anlageflächen mit sichtbarem Betrag stehen in Legende');
assert(visibleLegend.includes('Kauf') && !visibleLegend.includes('Verkauf') && visibleLegend.includes('Ungeprüfte Werktage'), 'Legende zeigt nur bewertbar gezeichnete Ereignisse und vorhandene Schraffur');
assertEqual(managerHistoryLegend(null), '', 'Kein Diagramm erhält keine Legende');
renderManagerWealthHistory(doc, { profiles: [{ id: 'a', name: 'A' }] }, registry, 'a', { kind: 'history', historyScope: 'household' });
assertEqual(nodes.managerWealthBasis.textContent, '', 'Ohne Tageslinie zeichnen erfasste Stände allein kein Diagramm');
assertEqual(nodes.managerWealthChart.innerHTML, '', 'Ohne Tageslinie bleibt die Diagrammfläche leer');
assertEqual(nodes.managerWealthLegend.innerHTML, '', 'Leere Auswahl entfernt fremde Legende');
renderManagerWealthHistory(doc, { profiles: [{ id: 'a', name: 'A', history: { ...history, points: [] } }] }, registry, 'a', { kind: 'history', historyScope: 'person' });
assertEqual(nodes.managerWealthChart.innerHTML, '', 'Tagesprojektion ohne abgeschlossenen Tag zeichnet wie bisher kein Diagramm');
assertEqual(JSON.stringify([state, history]), before, 'Anzeige verändert keine Datenquellen');
assertEqual(registry.profiles.a.data[WEALTH_CAPTURES_KEY], captureRaw, 'Gespeicherte Erfassungen bleiben unverändert');

// Die verschobenen Kennzahlen behalten dieselbe Tagesbewertung, auch bei abweichenden erfassten Ständen.
const { evaluateWealthHistory } = await import('../app/tranches/tranchen-history-model.js');
const start = historyDay('2026-01-01');
const daily = evaluateWealthHistory({ startDate: '2026-01-01', today: '2026-01-07',
    profiles: [{ id: 'a', currentCash: 100, cashHistory: { version: 1, baselineValue: 100, entries: [] },
        lots: [{ trancheId: 'holiday', purchaseDate: '2025-12-15', shares: 10, purchasePrice: 200, type: 'anleihe', ticker: 'BOND', name: 'Mustermann' }] }],
    prices: { symbols: { BOND: { currency: 'EUR', days: [start + 1, start + 4, start + 5], closes: [100, 120, 110], queried: [[start, start + 5]] } } } });
frozen(daily);
const values = html => [...html.matchAll(/class="expenses-card-value[^"]*">([^<]+)</g)].map(match => match[1].replace(/\s+/g, ' ').trim());
// OP-2 (Punkt 1): Vor den fünf Kennzahlen steht die Kachel „Stand“; die fünf Werte bleiben exakt.
assertEqual(JSON.stringify(values(dailyHistoryMetricsMarkup(daily))), JSON.stringify(['1.200 €', '+100 €', '0 €', '+100 €', '1.300 €', '−7,7 %']), 'Stand plus alle fünf verschobenen Feiertagskennzahlen bleiben exakt');
const dailyModel = { profiles: [{ id: 'a', name: 'Max Mustermann', history: daily }, { id: 'b', name: 'Erika Mustermann' }], householdHistory: daily };
renderManagerWealthHistory(doc, dailyModel, registry, 'a', { kind: 'history', historyScope: 'household' });
assert(nodes.managerDailyPeriod.innerHTML.includes('02.01.2026 · vorläufig') && nodes.managerDailyPeriod.innerHTML.includes('06.01.2026'), 'Eigene Tagesgruppe nennt Messbeginn, Status und Endtag');
assert(!nodes.managerDailyPeriod.innerHTML.includes('2027'), 'Erfasste Stände erweitern niemals den Kennzahlenzeitraum');
// OP-1 (Punkt 1): Der Block „Aufteilung am …“ über den Kacheln entfällt; die Aufteilung steht nur noch im Maus-Hinweis, mit Anteil.
assert(!Object.values(nodes).some(node => `${node.innerHTML}${node.textContent}`.includes('Aufteilung am')), 'OP-1 Punkt 1: Verlauf zeigt keinen Block „Aufteilung am“ mehr');
const lastRows = historyDayRows(daily.points.at(-1), daily).map(row => row.text);
assert(lastRows.some(row => /^Anleihen: 1\.100\s€ · 91,7\s%$/.test(row)) && lastRows.some(row => /^Tagesgeld: 100\s€ · 8,3\s%$/.test(row)),
    'OP-1 Punkt 1: Maus-Hinweis am letzten Tag nennt Betrag und Anteil wie der frühere Block: ' + lastRows.join(' | '));
assert(dailyHistoryMetricsMarkup(daily).includes('Aus Tagesgeld-Rückgängen') && !dailyHistoryMetricsMarkup(daily).includes('erfassten'), 'OP-1 Nachtrag 2: Entnahmen nennen „Aus Tagesgeld-Rückgängen“');
assert(nodes.managerDailyInfo.innerHTML.includes('Transfers') && nodes.managerDailyInfo.innerHTML.includes('keine Rendite') && nodes.managerDailyStatus.textContent.includes('rückwirkend angenommen'), 'Kurze Lesehilfe im Infofeld und Basisannahme im sichtbaren Datenstatus');
const dailyBytes = JSON.stringify(dailyModel);
renderManagerWealthHistory(doc, dailyModel, registry, 'b', { kind: 'history', historyScope: 'person' });
assert(nodes.managerDailyStatus.textContent.includes('Noch keine') && values(nodes.managerDailyMetrics.innerHTML).every(value => value === '—'), 'Fehlende Tageshistorie zeigt keine erfundenen Nullen');
assertEqual(JSON.stringify(dailyModel), dailyBytes, 'Haushalts-/Personenwechsel verändert keine Tagesquelle');
for (const missing of [false, true]) {
    const cash = evaluateWealthHistory({ startDate: '2026-01-01', today: '2026-01-04', profiles: [
        { id: 'a', currentCash: 80, lots: [], cashHistory: missing ? null : { version: 1, baselineValue: 100, entries: [{ date: '2026-01-02', value: 80 }] } },
        { id: 'b', currentCash: 50, lots: [] }] });
    assertEqual(values(dailyHistoryMetricsMarkup(cash))[2], missing ? '0 €' : '20 €', 'Entnahmen behalten Haushaltsbeiträge trotz fehlender Cashhistorie');
}

for (const [period, phrase] of [['1m', 'im letzten Monat'], ['1w', 'in der letzten Woche']]) {
    assert(dailyHistoryMetricsMarkup({ ...daily, range: { ...daily.range, period } }).includes(phrase), 'Personenkennzahlen nennen ' + phrase);
}
const fs = await import('node:fs');
const managerHtml = fs.readFileSync(new URL('../depot-tranchen-manager.html', import.meta.url), 'utf8');
const periodLabels = [...managerHtml.matchAll(/data-manager-history-period="[^"]+" aria-pressed="[^"]+">([^<]+)</g)].map(m => m[1]);
assertEqual(JSON.stringify(periodLabels), JSON.stringify(['Alles', 'Laufendes Jahr', 'Letzte 12 Monate', 'Letzter Monat', 'Letzte Woche']), 'Manager nutzt dieselben fünf Zeitraumtexte');
for (const removed of ['managerCaptureWealthBtn', 'Stand jetzt erfassen', 'Aus erfassten Ständen', 'managerWealthMetrics', 'managerWealthTable',
    'managerWealthRecords', 'Erfasste Vermögensstände', 'managerWealthPersonHint', 'Ältere Stände', 'Rauten']) {
    assert(!managerHtml.includes(removed), 'VS-2: Verlauf enthält keine Anzeige erfasster Stände mehr: ' + removed);
}
const dailyAt = managerHtml.indexOf('id="managerDailyMetrics"'), chartAt = managerHtml.indexOf('id="managerWealthChart"');
assert(dailyAt > 0 && dailyAt < chartAt, 'VS-2: Kennzahlen „Aus Tageskursen“ stehen über dem Diagramm an der Stelle der alten Kacheln');

// OP-2 (Punkt 1): Kachel „Stand am …“ = letzter Kurvenpunkt (Gesamtvermögen und „davon Geldvermögen“), für Haushalt und eine Person,
// bei „Alles“ und „Letzte Woche“. Ohne Immobilien entfällt „davon Geldvermögen“; ohne Wert am letzten Tag steht „Nicht verfügbar“.
{
    const { projectProfileWealthHistory } = await import('../app/profile/profile-wealth-history.js');
    const { PROFILE_CASH_HISTORY_KEY } = await import('../app/profile/profile-wealth-history.js');
    const cashData = (baselineValue, entries) => ({ depot_tranchen: '[]', [PROFILE_CASH_HISTORY_KEY]: JSON.stringify({ version: 1, baselineValue, entries }) });
    const standRegistry = { profiles: { max: { data: cashData(1000, [{ date: '2026-01-03', value: 1200 }, { date: '2026-01-16', value: 1150 }]) },
        erika: { data: cashData(500, [{ date: '2026-01-10', value: 650 }]) } } };
    const persons = [{ id: 'max', name: 'Max', valid: true, belongs: true,
        values: { tagesgeld: 1150, immobilien: [{ id: 'haus', nutzung: 'selbst', wert: 300000, stand: '2025-06' }] } },
        { id: 'erika', name: 'Erika', valid: true, belongs: true, values: { tagesgeld: 650 } }];
    const historyContext = { status: 'ready', startDate: '2026-01-01', today: '2026-01-20', prices: { version: 1, symbols: {} }, events: [] };
    const project = (period, profileId = null) => projectProfileWealthHistory(standRegistry, persons, { ...historyContext, period, profileId });
    const standModel = { profiles: persons.map(person => ({ ...person, history: project('all', person.id) })), householdHistory: project('all'), historyContext };
    const standNodes = Object.fromEntries(Object.keys(nodes).map(id => [id, { innerHTML: '', textContent: '' }]));
    let periodClick = null;
    standNodes.managerHistoryPeriods = { addEventListener: (type, handler) => { periodClick = handler; } };
    const standDoc = { getElementById: id => standNodes[id] };
    const tile = () => {
        const html = standNodes.managerDailyMetrics.innerHTML;
        const first = html.slice(0, html.indexOf('</div></div>') + 12);
        const text = cls => first.match(new RegExp(`class="${cls}[^"]*">([^<]*)<`))?.[1] ?? null;
        return { label: text('expenses-card-label'), value: text('expenses-card-value'), sub: text('expenses-card-sub') };
    };
    const choose = period => periodClick({ target: { closest: () => ({ dataset: { managerHistoryPeriod: period } }) } });
    for (const [scope, activeId, view] of [['Haushalt', 'max', { kind: 'history', historyScope: 'household' }], ['Max', 'max', { kind: 'history', historyScope: 'person' }]]) {
        renderManagerWealthHistory(standDoc, standModel, standRegistry, activeId, view);
        const seen = [];
        for (const period of ['all', '1w']) {
            choose(period);
            const expected = project(period, scope === 'Haushalt' ? null : activeId);
            const last = expected.points.at(-1);
            const rows = historyDayRows(last, expected).map(row => row.text);
            const shown = tile();
            assert(expected.hasHomes && last.totalWithHomes !== last.total, `${scope}/${period}: Gesamtvermögen und Geldvermögen unterscheiden sich im Beispiel`);
            assertEqual(shown.label, 'Stand am ' + last.date.split('-').reverse().join('.'), `${scope}/${period}: Kachel nennt den letzten Tag des Zeitraums`);
            assertEqual('Gesamtvermögen: ' + shown.value, rows[1], `${scope}/${period}: Kachelwert = Gesamtvermögen des letzten Kurvenpunkts im Maus-Hinweis`);
            assertEqual(shown.sub, rows[2], `${scope}/${period}: „davon Geldvermögen“ = Geldvermögen des letzten Kurvenpunkts im Maus-Hinweis`);
            seen.push(JSON.stringify(shown));
        }
        assertEqual(seen[1], seen[0], `${scope}: Zeitraumwechsel ändert die Kachel nicht, solange der letzte Tag gleich bleibt`);
        assert(standNodes.managerDailyMetrics.innerHTML.indexOf('Stand am') < standNodes.managerDailyMetrics.innerHTML.indexOf('Veränderung Geldvermögen'), `${scope}: „Stand“ ist die erste Kachel`);
        choose('all');
    }
    renderManagerWealthHistory(standDoc, standModel, standRegistry, 'erika', { kind: 'history', historyScope: 'person' });
    const erika = tile(), erikaLast = standModel.profiles[1].history.points.at(-1);
    assertEqual(erika.value, historyDayRows(erikaLast, standModel.profiles[1].history)[1].text.replace('Gesamtvermögen: ', ''), 'Person ohne Immobilien: Kachelwert = letzter Kurvenpunkt');
    assertEqual(erika.sub, '', 'Ohne Immobilien entfällt „davon Geldvermögen“');
    const unknownLast = { ...daily, points: [...daily.points.slice(0, -1), { ...daily.points.at(-1), total: null }] };
    const unknown = values(dailyHistoryMetricsMarkup(unknownLast));
    assert(unknown[0] === '—' && dailyHistoryMetricsMarkup(unknownLast).includes('Nicht verfügbar'), 'Ohne Wert am letzten Tag zeigt die Kachel „Nicht verfügbar“');
    assert(dailyHistoryMetricsMarkup(null).startsWith('<div class="wealth-metric ds-kpi"><div class="expenses-card-label">Stand</div>'), 'Ohne Verlauf heißt die Kachel nur „Stand“');
}
const pvCss = fs.readFileSync(new URL('../css/personen-vermoegen.css', import.meta.url), 'utf8');
assert(pvCss.includes('.manager-daily-history .wealth-metrics { grid-template-columns: repeat(6, minmax(0, 1fr)); }'), 'OP-2 Punkt 1: Kachelzeile im Verlauf ist sechsspaltig');
assert(pvCss.includes('.manager-daily-history .wealth-metrics > .ds-kpi:nth-child(3n + 1) { border-inline-start: 0; }')
    && pvCss.includes('.manager-daily-history .wealth-metrics > .ds-kpi:nth-child(n + 4) { border-block-start: 1px solid var(--border); }'), 'OP-2 Nachtrag 2: unter 1600 px Trennlinien in beiden Zeilen wie in der ersten');
