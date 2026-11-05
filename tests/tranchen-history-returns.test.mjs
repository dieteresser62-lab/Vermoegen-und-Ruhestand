import { historyDay as d } from '../app/tranches/tranchen-history-store.js';
import { historyDailyReturn, historyXirr, buildHistoryReturnSeries, historyReturnMetrics,
    historyMonthlyReturns, evaluateHistoryReturns, selectHistoryReturnMetrics } from '../app/tranches/tranchen-history-returns.js';
import { historyRiskMarkup, historyMonthlyMarkup, historyYearsMarkup, renderManagerHistoryReturns } from '../app/tranches/tranchen-history-returns-ui.js';

const near = (actual, expected, message) => assert(Number.isFinite(actual) && Math.abs(actual - expected) < 1e-9, message + ` (${actual})`);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const points = (values, start = '2026-01-02') => values.map((total, index) => ({ day: d(start) + index, total, evaluated: true }));

const constant = buildHistoryReturnSeries(points(Array.from({ length: 11 }, (_, i) => 100 * 1.01 ** i)));
const cm = historyReturnMetrics(constant);
near(cm.twr, 1.01 ** 10 - 1, 'Konstante Tagesrendite wird verkettet');
near(cm.volatility, 0, 'Konstante Tagesrendite hat Schwankung 0');
assertEqual(cm.recovery.days, 0, 'Steigende Reihe hat keine Erholungsstrecke');
near(historyDailyReturn(100, 202, 100), 0.01, 'Kauf zählt am Tagesbeginn');
near(historyDailyReturn(100, 50, 0, 50), 0, 'Verkauf zählt am Tagesende');
assertEqual(historyDailyReturn(0, 100), null, 'Nicht bewertbare Nullbasis bleibt offen');
const buy = historyReturnMetrics(buildHistoryReturnSeries(points([100, 101, 203.01, 205.0401]), [{ kind: 'buy', day: d('2026-01-04'), amount: 100 }]));
near(buy.twr, 1.01 ** 3 - 1, 'Kauf mitten im Zeitraum ändert zeitgewichtete Rendite nicht');
near(buy.netFlows, 100, 'Käufe/Verkäufe zählen Einzahlungen');
near(buy.change, 105.0401, 'Wertänderung ist Endwert minus Anfangswert');
near(buy.market, 5.0401, 'Markt ist Wertänderung abzüglich Flüssen');
const sell = historyReturnMetrics(buildHistoryReturnSeries(points([100, 50, 50]), [{ kind: 'sell', day: d('2026-01-03'), amount: 50 }]));
near(sell.twr, 0, 'Verkauf erzeugt keinen Renditeverlust');
near(sell.drawdown.value, 0, 'Verkauf erzeugt keinen Rückgang');
near(historyXirr([{ day: d('2025-01-01'), amount: -100 }, { day: d('2026-01-01'), amount: 110 }]), 0.1, 'IZF 100 auf 110 in 365 Tagen ist 10 %');
near(historyXirr([{ day: d('2025-01-01'), amount: -100 }, { day: d('2026-01-01'), amount: 50 }]), -0.5, 'Negativer IZF bleibt lösbar');
near(historyXirr([{ day: d('2025-01-01'), amount: -100 }, { day: d('2026-01-01'), amount: 10000 }]), 99, 'Bisektion löst großen Zins nach Newtonabbruch');
assertEqual(historyXirr([{ day: 1, amount: -100 }, { day: 366, amount: -110 }]), null, 'IZF ohne Vorzeichenwechsel hat keine Lösung');
const year = historyReturnMetrics(buildHistoryReturnSeries([{ day: d('2025-01-01'), total: 100, evaluated: true }, { day: d('2026-01-01'), total: 110, evaluated: true }]));
near(year.annualized, 0.1, 'Ab 365 Tagen zusätzliche Jahresrendite');
near(year.xirr, 0.1, 'IZF verwendet Anfangs- und Endbestand');
const open = historyReturnMetrics(buildHistoryReturnSeries(points([100, 90, 80, 85])));
assertEqual(open.recovery.days, 3, 'Offene Erholung zählt Kalendertage');
assertEqual(open.recovery.open, true, 'Offene Erholung ist gekennzeichnet');
near(open.drawdown.value, -0.2, 'Rückgang auf Renditeindex');
assert(historyRiskMarkup(open).includes('3+ Tage') && historyRiskMarkup(open).includes('noch nicht erholt'), 'Offene Erholung erscheint als n+ Tage');
const recovered = historyReturnMetrics(buildHistoryReturnSeries(points([100, 90, 100, 110])));
assertEqual(recovered.recovery.days, 2, 'Wiedererreichen schließt Erholung');
assertEqual(recovered.recovery.open, false, 'Geschlossene Erholung');
const gap = buildHistoryReturnSeries([{ day: 1, total: 100, evaluated: true }, { day: 2, total: 200, evaluated: false }, { day: 5, total: 202, evaluated: true }], [{ kind: 'buy', day: 2, amount: 100 }]);
near(gap[1].rate, 0.01, 'Lücke mit Fluss wird am nächsten bewerteten Tag verrechnet');
assertEqual(gap.length, 2, 'Lückentage liefern keine künstlichen Nullrenditen');
const months = historyMonthlyReturns(buildHistoryReturnSeries(points([100, 101, 102.01], '2026-01-30')), {
    start: d('2026-01-30'), end: d('2026-02-01'), today: '2026-02-02', firstHoldingDay: d('2026-01-30') });
assert(months[0].months[0].partial && months[0].months[1].partial, 'Verlaufsbeginn und heutiger Monat sind Teilmonate');
near(months[0].value, 0.0201, 'Jahresspalte verkettet Monate');
assertEqual(historyReturnMetrics(buildHistoryReturnSeries(points([100]))).status, 'insufficient', 'Zu wenig Verlauf');
assert(historyRiskMarkup({ status: 'insufficient' }).includes('Noch zu wenig Verlauf für Kennzahlen.'), 'Ruhiger Leerzustand');

const lot = (id, type, purchaseDate, shares, purchasePrice = 10, ticker = 'TEST') => ({ trancheId: id, name: id, type, purchaseDate, shares, purchasePrice, ticker, tqf: 0, source: 'spielwert' });
const prices = { symbols: { TEST: { currency: 'EUR', days: ['2025-12-31', '2026-01-02', '2026-01-05', '2026-01-06'].map(d),
    closes: [10, 11, 11, 12.1], queried: [[d('2025-12-31'), d('2026-01-06')]] } } };
const input = freeze({ profiles: [{ id: 'max', currentCash: 999999, lots: [lot('alt', 'aktien_alt', '2025-12-01', 10), lot('neu', 'aktien_neu', '2026-01-05', 10, 11)] },
    { id: 'erika', currentCash: 100, lots: [lot('gold', 'gold', '2025-12-01', 10)] },
    { id: 'outside', belongsToHousehold: false, lots: [lot('outside', 'geldmarkt', '2025-12-01', 999)] }],
    prices, startDate: '2025-12-31', today: '2026-01-07' });
const bytes = JSON.stringify(input), household = evaluateHistoryReturns(input);
near(household.metrics.twr, 0.21, 'Haushalt nutzt alle Anlagen ohne Tagesgeld, einschließlich neuer Anlageform');
assertEqual(household.groups.length, 3, 'Nur Anlageformen mit Bestand im Verlauf');
assert(household.groups.find(g => g.type === 'aktien_neu').monthly[0].months[0].partial, 'Erster Bestand im Monat ist Teilmonat');
assertEqual(JSON.stringify(input), bytes, 'Eingefrorene Quellen bleiben bytegleich');
near(evaluateHistoryReturns({ ...input, profileId: 'max' }).metrics.twr, 0.21, 'Personenwahl begrenzt Bestände und Flüsse');
near(selectHistoryReturnMetrics(household, 'year').twr, 0.21, 'Jahreswahl nutzt vorangehenden Schlussstand als Vergleich');
assertEqual(household.years[0].year, 2026, 'Jahresübersicht neuestes Jahr links');
assert(historyMonthlyMarkup(household).includes('(10,0)') && !historyMonthlyMarkup(household).includes(' open'), 'Teilmonate in Klammern, Klappen zunächst zu');
assert(historyYearsMarkup(household).includes('davon Käufe/Verkäufe'), 'Jahresübersicht erklärt Flussanteil');
assert(!historyMonthlyMarkup(household).includes('style='), 'Heatmap verwendet Klassen statt Inline-Stilen');
const missing = evaluateHistoryReturns({ ...input, prices: { symbols: {} } });
assertEqual(missing.metrics.status, 'unavailable', 'Ohne vollständig bewertbaren Tag bleiben Kennzahlen nicht bewertbar');
assert(missing.provisional, 'Fehlende Erstkurse bleiben vorläufig');

// AQ-1: Ein späterer Kauf ohne Ticker darf alte Renditen nicht als vollständig ausgeben.
const unpriced = lot('Auto-Fonds', 'aktien_neu', '2026-01-05', 1, 10, '');
const withUnpriced = evaluateHistoryReturns({ ...input, profiles: [{ id: 'max', lots: [
    lot('ETF', 'aktien_neu', '2025-12-31', 10), unpriced
] }] });
near(withUnpriced.metrics.twr, .1, 'Rendite endet bei +10 % vor dem nicht bewertbaren Zukauf');
assertEqual(withUnpriced.metrics.status, 'provisional', 'Später unvollständiger Gesamtbestand ist vorläufig');
assertEqual(withUnpriced.metrics.end, d('2026-01-02'), 'Kennzahlen enden am letzten vollständig bewerteten Kurstag');
assertEqual(withUnpriced.coverage.missing[0], 'Auto-Fonds', 'Hinweis benennt die Anlage ohne Kurs');
assertEqual(withUnpriced.years[0].end, d('2026-01-02'), 'Jahreskarte und Kurve enden am selben Stichtag');
assert(withUnpriced.monthly[0].months[0].partial, 'Abgeschnittener Monat wird als Teilmonat gekennzeichnet');
for (const markup of [historyRiskMarkup(selectHistoryReturnMetrics(withUnpriced, 'all')), historyMonthlyMarkup(withUnpriced), historyYearsMarkup(withUnpriced)]) {
    assert(markup.includes('vorläufig: bis 02.01.2026 – danach nicht bewertbar (Auto-Fonds ohne Kurs)'), 'Alle drei Karten nennen Stichtag und fehlenden Kurs');
}
const affectedGroup = withUnpriced.groups.find(group => group.type === 'aktien_neu');
assertEqual(affectedGroup.metrics.status, 'provisional', 'Auch die betroffene Anlageform bleibt vorläufig');
near(affectedGroup.metrics.twr, .1, 'Anlageform rechnet bis zum vollständig bewerteten Tag');
const repeatedUnpriced = evaluateHistoryReturns({ ...input, profiles: [
    { id: 'max', lots: [lot('ETF', 'aktien_neu', '2025-12-31', 10), unpriced,
        { ...unpriced, trancheId: 'zweite-tranche' }, { ...unpriced, trancheId: 'boot', name: 'Boot-Fonds' }] },
    { id: 'erika', lots: [{ ...unpriced, trancheId: 'partner-tranche' }] }
] });
for (const result of [repeatedUnpriced, repeatedUnpriced.groups.find(group => group.type === 'aktien_neu')]) {
    assertEqual(JSON.stringify(result.coverage.missing), '["Auto-Fonds","Boot-Fonds"]', 'Fehlende Anlagennamen sind über Tranchen und Personen eindeutig');
}
for (const markup of [historyRiskMarkup(selectHistoryReturnMetrics(repeatedUnpriced, 'all')), historyMonthlyMarkup(repeatedUnpriced), historyYearsMarkup(repeatedUnpriced)]) {
    assert(markup.includes('(Auto-Fonds, Boot-Fonds ohne Kurs)'), 'Alle Karten nennen jeden fehlenden Anlagennamen nur einmal je Hinweis');
}
assert(historyRiskMarkup({ ...withUnpriced.metrics, coverage: { ...withUnpriced.coverage,
    missing: ['Auto-Fonds', 'Auto-Fonds', 'Boot-Fonds'] } }).includes('(Auto-Fonds, Boot-Fonds ohne Kurs)'), 'Auch die Hinweisformatierung fasst doppelte Namen zusammen');
const mixed = evaluateHistoryReturns({ ...input, profiles: [{ id: 'max', lots: [
    lot('ETF', 'aktien_neu', '2025-12-31', 10), { ...unpriced, type: 'gold' }
] }] });
assertEqual(mixed.groups.find(group => group.type === 'aktien_neu').metrics.status, 'complete', 'Bewertbare andere Anlageform bleibt vollständig');
assertEqual(mixed.groups.find(group => group.type === 'gold').metrics.status, 'unavailable', 'Anlageform ganz ohne Kurs zeigt keine Zahlen');
const noPricedDays = 'Noch keine bewertbaren Tage: Auto-Fonds ohne Kurs';
const unpricedGroupBody = historyMonthlyMarkup(mixed).match(/data-history-return-group="gold"[^>]*>[\s\S]*?<\/summary>([\s\S]*?)<\/details>/)?.[1];
assert(unpricedGroupBody?.includes(noPricedDays), 'Aufgeklappte Anlageform ohne bewertbaren Tag nennt die fehlende Anlage im Inhalt');
assert(!unpricedGroupBody?.includes('<table'), 'Anlageform ohne bewertbaren Tag zeigt keine leere Tabelle');
const neverPriced = evaluateHistoryReturns({ ...input, profiles: [{ id: 'max', lots: [unpriced] }] });
for (const markup of [historyRiskMarkup(selectHistoryReturnMetrics(neverPriced)), historyMonthlyMarkup(neverPriced), historyYearsMarkup(neverPriced)]) {
    assert(markup.includes(noPricedDays), 'Ohne bewertbaren Tag nennen alle Karten dieselbe Ursache wie die Anlageform');
    assert(!/history-return-grid|<table|history-return-year-card/.test(markup), 'Ohne bewertbaren Tag keine Kennzahlen');
}
const newYear = evaluateHistoryReturns({ ...input, today: '2027-01-07', profiles: [{ id: 'max', lots: [
    lot('ETF', 'aktien_neu', '2025-12-31', 10), unpriced
] }] });
assertEqual(selectHistoryReturnMetrics(newYear, 'year').status, 'unavailable', 'Dieses Jahr ohne bewertbaren Tag verwendet keine ältere Rendite');
assert(!historyRiskMarkup(selectHistoryReturnMetrics(newYear, 'year')).includes('vorläufig: bis'), 'Kein veralteter Stichtag außerhalb des gewählten Zeitraums');
const distributionNote = 'Kursrendite ohne Ausschüttungen; bei ausschüttenden Fonds zu niedrig';
assert(historyRiskMarkup(cm).includes(distributionNote) && historyRiskMarkup(cm).includes('ohne Ausschüttungen') && historyRiskMarkup(cm).includes('Mehr im Handbuch'), 'Renditehinweis bleibt sichtbar; die kurze Begriffserklärung verlinkt Details');

const delayed = freeze({ profiles: [
    { id: 'max', lots: [lot('gold', 'gold', '2025-12-31', 1)] },
    { id: 'erika', lots: [lot('spaet', 'aktien_neu', '2026-01-02', 1)] }
], prices: { symbols: { TEST: { currency: 'EUR',
    days: ['2023-12-29', '2024-01-02', '2024-12-31', '2025-01-02', '2025-12-30', '2025-12-31', '2026-01-02', '2026-01-05', '2026-01-06'].map(d),
    closes: [10, 10, 10, 10, 10, 10, 10, 11, 9.9], queried: [[d('2023-12-29'), d('2026-01-06')]] }
} }, startDate: '2023-12-29', today: '2026-01-07' });
const lateHousehold = evaluateHistoryReturns(delayed), lateGroup = lateHousehold.groups.find(group => group.type === 'aktien_neu');
assertEqual(lateGroup.series[0].day, d('2026-01-02'), 'Anlageform beginnt erst am ersten Kauf');
assertEqual(lateGroup.series.length, 3, 'Kurse vor dem Kauf zählen nicht als Nullrenditen');
near(lateGroup.metrics.volatility, Math.sqrt(0.02 * 252), 'Schwankung der Anlageform verwendet nur die Renditen +10 % und −10 % ab Kauf');
near(lateGroup.metrics.twr, -0.01, 'Rendite der Anlageform beginnt mit dem ersten Kaufbestand');
near(lateGroup.metrics.drawdown.value, -0.1, 'Rückgang der Anlageform beginnt mit dem ersten Kaufbestand');
assertEqual(lateGroup.monthly.length, 1, 'Monatsreihe der Anlageform enthält keine Jahre vor dem Kauf');
assertEqual(lateHousehold.series[0].day, d('2025-12-31'), 'Alle Anlagen beginnen mit dem ersten Kauf überhaupt');
near(lateHousehold.metrics.volatility, Math.sqrt(0.01 * 252), 'Schwankung aller Anlagen enthält keine Nullrenditen vor dem ersten Kauf');
assertEqual(JSON.stringify(lateHousehold.years.map(year => year.year)), '[2026,2025]', 'Jahresübersicht enthält keine Jahre vor dem ersten Bestand');
assert(lateHousehold.years.every(year => year.points.every(point => point.day >= d('2025-12-31'))), 'Jahreskurven enthalten keine Tage vor dem ersten Kauf');
assertEqual(lateHousehold.years[1].start, d('2025-12-31'), 'Erstes Anlagejahr beginnt am Kaufdatum');
const latePerson = evaluateHistoryReturns({ ...delayed, profileId: 'erika' });
assertEqual(latePerson.years.length, 1, 'Person ohne frühere Anlagen sieht keine leeren Jahreskarten');
assert(!historyYearsMarkup(latePerson).includes('Anlagen 2025'), 'Jahreskarte vor dem ersten Kauf wird nicht dargestellt');
assertEqual(latePerson.monthly.length, 1, 'Gesamte Monatsreihe beginnt erst im ersten Anlagejahr');

const cashOnly = evaluateHistoryReturns({ ...input, profiles: [{ id: 'max', currentCash: 100, lots: [lot('cash', 'cash', '2025-12-01', 100)] }] });
assertEqual(cashOnly.metrics.status, 'insufficient', 'Nur Tagesgeld liefert keine Depotkennzahlen');
assertEqual(cashOnly.series.length, 0, 'Nur Tagesgeld liefert keine Renditereihe');
assertEqual(cashOnly.monthly.length, 0, 'Nur Tagesgeld liefert keine Monatsreihe');
assertEqual(cashOnly.years.length, 0, 'Nur Tagesgeld liefert keine Jahreskarten');
for (const markup of [historyRiskMarkup(selectHistoryReturnMetrics(cashOnly)), historyMonthlyMarkup(cashOnly), historyYearsMarkup(cashOnly)]) {
    assert(markup.includes('Noch zu wenig Verlauf für Kennzahlen.'), 'Alle drei Karten zeigen bei reinem Tagesgeld den Leerhinweis');
}

const uncertainLot = lot('unbekannt', 'anleihe', '2026-01-05', 1);
const incomplete = evaluateHistoryReturns({ ...input, profiles: [...input.profiles, { id: 'unsicher', lots: [{
    tranche: uncertainLot, status: 'unknown', uncertainty: { fromDate: '2026-01-05', originalTranche: uncertainLot }
}] }] });
assert(incomplete.invalid && incomplete.series.length >= 2, 'Unvollständiger Bestand bleibt trotz früher bewerteter Tage ungültig');
const unavailableSeries = buildHistoryReturnSeries(points([0, 100]));
const unavailableMetrics = historyReturnMetrics(unavailableSeries);
assertEqual(unavailableMetrics.status, 'unavailable', 'Nicht bewertbare Tagesrendite sperrt Kennzahlen');
const invalidEmpty = evaluateHistoryReturns({ ...input, profiles: [{ id: 'max', error: 'Synthetischer Verlaufsfehler', lots: [] }] });
for (const result of [incomplete, invalidEmpty, { ...household, series: unavailableSeries, metrics: unavailableMetrics }]) {
    const metrics = result.invalid ? selectHistoryReturnMetrics(result) : result.metrics;
    for (const markup of [historyRiskMarkup(metrics), historyMonthlyMarkup(result), historyYearsMarkup(result)]) {
        assert(markup.includes('Kennzahlen nicht bewertbar: Verlaufsdaten unvollständig.'), 'Alle drei Karten erklären unvollständige Verlaufsdaten');
        assert(!/history-return-grid|<table|history-return-year-card/.test(markup), 'Ungültige Kennzahlen zeigen keine Zahlenraster oder Tabellen');
    }
}

// Der verborgene Reiter darf weder Quellen lesen noch Kennzahlen rechnen.
let reads = 0;
const doc = { getElementById: () => ({ addEventListener() {} }) };
renderManagerHistoryReturns(doc, { get historyContext() { reads++; throw new Error('Verborgener Zugriff'); } }, {}, 'max', { kind: 'person' });
assertEqual(reads, 0, 'Nur beim Anzeigen des Reiters rechnen');

// Kleiner DOM-Host für den echten Reiterbinder; native Klappen werden nur abgebildet.
const nodes = Object.fromEntries(['managerHistoryReturns', 'managerHistoryRisk', 'managerHistoryMonthly', 'managerHistoryYears'].map(id => [id, {
    listeners: [], details: [], html: '', addEventListener(type, callback) { this.listeners.push(callback); },
    set innerHTML(html) {
        this.html = html;
        this.details = [...html.matchAll(/data-history-return-group="([^"]+)"/g)].map(([, type]) => ({
            open: false, querySelector: () => ({ textContent: type })
        }));
    }, get innerHTML() { return this.html; }, querySelectorAll() { return []; }
}]));
nodes.managerHistoryReturns.querySelectorAll = selector => selector.startsWith('details')
    ? nodes.managerHistoryMonthly.details.filter(detail => selector === 'details' || detail.open) : [];
const uiDoc = { getElementById: id => nodes[id], querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
const registry = { profiles: Object.fromEntries(input.profiles.map(profile => [profile.id, { data: { depot_tranchen: JSON.stringify(profile.lots) } }])) };
const projection = { historyContext: { status: 'ready', prices, events: [], startDate: input.startDate, today: input.today },
    profiles: input.profiles.map(profile => ({ id: profile.id, valid: true, belongs: profile.belongsToHousehold !== false })) };
const show = (kind = 'history', historyScope = 'household') => renderManagerHistoryReturns(uiDoc, projection, registry, 'max', { kind, historyScope });
show();
assert(nodes.managerHistoryRisk.innerHTML.includes('data-history-return-period="year" aria-pressed="true"'), 'Reiter startet mit Dieses Jahr');
assert(nodes.managerHistoryMonthly.details.length > 0, 'Echter Binder stellt Anlageklappen dar');
const monthlyBefore = nodes.managerHistoryMonthly.innerHTML;
nodes.managerHistoryRisk.listeners[0]({ target: { closest: () => ({ dataset: { historyReturnPeriod: 'all' } }) } });
assert(nodes.managerHistoryRisk.innerHTML.includes('data-history-return-period="all" aria-pressed="true"'), 'Zeitraumknopf zeichnet Renditekarte neu');
assertEqual(nodes.managerHistoryMonthly.innerHTML, monthlyBefore, 'Zeitraumknopf erhält den gesamten Monatsverlauf');
nodes.managerHistoryMonthly.details[0].open = true;
show();
assert(nodes.managerHistoryMonthly.details[0].open, 'Neuzeichnen im selben Kontext erhält offene Anlageklappe');
show('person'); show();
assert(nodes.managerHistoryMonthly.details.every(detail => !detail.open), 'Erneutes Öffnen des Reiters schließt Anlageklappen');
nodes.managerHistoryMonthly.details[0].open = true;
show('history', 'person');
assert(nodes.managerHistoryMonthly.details.every(detail => !detail.open), 'Personenwahl schließt fremde Anlageklappen');
assertEqual(nodes.managerHistoryRisk.listeners.length, 1, 'Reiterbinder bindet Zeitraumwahl nur einmal');

const start = d('2016-01-01'), days = Array.from({ length: 3653 }, (_, i) => start + i);
const tenYears = { profiles: [{ id: 'max', lots: ['aktien_alt', 'aktien_neu', 'geldmarkt', 'gold', 'anleihe'].map((type, i) => lot('lot' + i, type, '2015-01-01', 10)) }],
    prices: { symbols: { TEST: { currency: 'EUR', days, closes: days.map((_, i) => 10 * 1.0001 ** i), queried: [[days[0], days.at(-1)]] } } },
    startDate: '2016-01-01', today: '2026-01-01' };
evaluateHistoryReturns(tenYears);
const samples = [];
let long;
for (let i = 0; i < 3; i++) {
    const begin = performance.now();
    long = evaluateHistoryReturns(tenYears);
    samples.push(performance.now() - begin);
}
// Der schnellste vollständige Lauf begrenzt Scheduler-/GC-Rauschen in der parallelen Suite.
const elapsed = Math.min(...samples);
assert(long.series.length > 3600, 'Zehn Jahre Tageswerte vollständig berechnet');
assert(elapsed < 200, `Zehn Jahre unter 200 ms (${elapsed.toFixed(1)} ms)`);
console.log(`DK-1: zehn Jahre, fünf Anlageformen: ${elapsed.toFixed(1)} ms`);
