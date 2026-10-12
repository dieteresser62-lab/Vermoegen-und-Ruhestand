import { historyDay, historyDate } from '../app/tranches/tranchen-history-store.js';
import { projectManagerProfiles } from '../app/tranches/tranchen-manager-profiles.js';
import { renderManagerProfiles, renderTranchenTable } from '../app/tranches/tranchen-manager-renderer.js';

/** Identischer synthetischer Aufbau für Node- und externe DOM-/Frame-Messung. */
export function createHistoryPerformanceFixture() {
    const start = historyDay('2016-01-01'), days = Array.from({ length: 3650 }, (_, i) => start + i);
    const closes = days.map((_, i) => 100 + Math.sin(i / 23) * 10 + i / 100);
    closes[713] = 180.67; closes[1727] = 42.13;
    const tranches = Array.from({ length: 100 }, (_, i) => ({ schemaVersion: 2, trancheId: `perf-${i}`, name: `Synthetische Tranche ${i + 1}`,
        shares: 10, purchasePrice: 88.90, currentPrice: closes.at(-1), purchaseDate: '2016-01-01',
        ticker: 'PERF.DE', isin: '', category: 'equity', type: 'aktien_neu', tqf: .3, taxExempt: false, notes: '',
        marketValue: 10 * closes.at(-1), costBasis: 889 }));
    const sale = { actionId: 'perf-sale', eventType: 'sale_reconciled', profileId: 'a', trancheId: 'perf-0', executedAt: historyDate(start + 1101),
        actual: { sharesSold: 1, grossProceeds: closes[1101] }, result: { beforeShares: 11, remainingShares: 10 } };
    const context = { status: 'ready', startDate: '2016-01-01', today: historyDate(start + 3650), events: [sale],
        prices: { symbols: { 'PERF.DE': { currency: 'EUR', days, closes, queried: [[start, start + 3649]], failures: 0, lastError: null } } } };
    const profile = (id, lots, cash) => ({ meta: { id, name: `Person ${id}`, belongsToHousehold: true }, data: {
        depot_tranchen: JSON.stringify(lots), profile_tagesgeld: String(cash), profile_aktuelles_alter: '67',
        profile_cash_history_v1: JSON.stringify({ version: 1, baselineValue: cash, entries: [{ date: '2016-01-01', value: cash }] }) } });
    return { registry: { version: 1, profiles: { a: profile('a', tranches, 100), b: profile('b', [], 200) } }, tranches, context };
}
export function renderHistoryPerformanceFixture(doc, fixture) {
    const projection = projectManagerProfiles(fixture.registry, 'a', fixture.context);
    renderManagerProfiles(doc, projection);
    renderTranchenTable(doc.getElementById('tranchenTable'), fixture.tranches, { context: fixture.context, profileId: 'a', expandedId: 'perf-0' });
    return projection;
}

if (import.meta.url.startsWith('file:')) {
    const fixture = createHistoryPerformanceFixture(), before = JSON.stringify(fixture);
    const hosts = Object.fromEntries(['managerHousehold', 'managerPageTitle', 'managerProfileTabs', 'tranchenTable'].map(id => [id, { innerHTML: '' }]));
    const doc = { getElementById: id => hosts[id] };
    const run = () => { const start = performance.now(); const projection = renderHistoryPerformanceFixture(doc, fixture); return { elapsed: performance.now() - start, projection }; };
    run(); // Eigene Aufwärmprobe, nicht Teil der gemessenen Läufe.
    const samples = Array.from({ length: 3 }, run), timings = samples.map(s => s.elapsed).sort((a, b) => a - b);
    for (const { elapsed, projection } of samples) {
        assert(elapsed < 10000, 'Echter Managerpfad 100 × 3.650 bleibt pro Messlauf unter 10.000 ms');
        assert(projection.profiles.every(p => p.valid && p.history.points.length === 3650) && projection.householdHistory.points.length === 3650, 'Mengengerüst enthält zwei vollständige Personenreihen und Haushalt');
    }
    const table = hosts.tranchenTable.innerHTML, cards = hosts.managerHousehold.innerHTML;
    assertEqual((table.match(/class="tranche-row"/g) || []).length, 100, 'Mengengerüst enthält alle 100 Tabellenzeilen');
    assertEqual((table.match(/class="pv-history-detail"/g) || []).length, 1, 'Mengengerüst zeichnet genau ein geöffnetes Detail');
    assertEqual((cards.match(/class="history-sparkline"/g) || []).length, 3, 'Mengengerüst zeichnet Haushalt und zwei Personen');
    const attrs = source => [...source.matchAll(/data-drawing-points="(\d+)" data-mandatory-points="(\d+)" data-drawing-budget="(\d+)"/g)].map(m => ({ points: +m[1], mandatory: +m[2], budget: +m[3] }));
    const sparks = [...table.matchAll(/<svg class="history-sparkline"[^>]+>/g)].flatMap(m => attrs(m[0]));
    const actualSparkPoints = [...table.matchAll(/<svg class="history-sparkline"[^>]*>([\s\S]*?)<\/svg>/g)].map(m =>
        [...m[1].matchAll(/<path class="history-course"[^>]* d="([^"]+)"/g)].reduce((n, path) => n + path[1].split('L').length, 0));
    assert(actualSparkPoints.length === 100 && actualSparkPoints.every((count, i) => count === sparks[i].points), 'Unabhängig gezählte SVG-Pfadpunkte entsprechen der Auswahl aller 100 Kleinverläufe');
    const points = sparks.reduce((n, a) => n + a.points, 0), mandatory = sparks.reduce((n, a) => n + a.mandatory, 0);
    assert(sparks.length === 100 && points <= 20000 + mandatory && sparks.every(a => a.points <= a.budget + a.mandatory), '100 Tabellenkleinverläufe halten 20.000 reguläre Punkte plus Pflichtpunkte ein');
    assertEqual(JSON.stringify(fixture), before, 'Mengengerüst verändert weder Kurs-/Profilbytes noch Exportbasis');
    const h = samples[0].projection.householdHistory, totals = h.points.map(p => p.total);
    const first = totals[0], last = totals.at(-1), maximum = Math.max(...totals);
    let running = first, drawdown = 0;
    for (const total of totals) { running = Math.max(running, total); drawdown = Math.max(drawdown, (1 - total / running) * 100); }
    const oracle = { change: last - first, percent: (last - first) / first * 100, withdrawals: 0,
        adjusted: last - first, peak: maximum, drawdown };
    for (const { projection } of samples) {
        const metrics = projection.householdHistory.metrics;
        assert(metrics.change === oracle.change && metrics.percent === oracle.percent && metrics.withdrawals === oracle.withdrawals && metrics.adjusted === oracle.adjusted
            && metrics.peak.value === oracle.peak && metrics.drawdown.percent === oracle.drawdown, 'Unabhängiges Vollreihenorakel bestätigt sämtliche Kennzahlen nach Zeichnung');
        assertEqual(JSON.stringify(projection.householdHistory), JSON.stringify(h), 'Alle Messläufe behalten Messbeginn, Endwert und Tagesreihe bytegleich');
    }
    console.log(JSON.stringify({ nachweis: 'SOURCE-Node: Projektion und HTML, keine DOM-/Layoutmessung', tranchen: 100, tageJeTranche: 3650,
        laeufeMs: samples.map(s => +s.elapsed.toFixed(2)), medianMs: +timings[1].toFixed(2), maximumMs: +timings[2].toFixed(2),
        tabellenZeichnungspunkte: points, tabellenPflichtpunkte: mandatory, svgZeichnungspunkte: attrs(table + cards).reduce((n, a) => n + a.points, 0), htmlZeichen: table.length + cards.length }));
}
