import { historyDay } from '../app/tranches/tranchen-history-store.js';
import { historyRange, reconstructHistoryShares, historySharesAt, historyPriceAt, historyCashAt, historyMetrics, evaluateWealthHistory, evaluateHistoryCourse } from '../app/tranches/tranchen-history-model.js';
const d = historyDay;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const tranche = { trancheId: 'lot', purchaseDate: '2026-01-02', purchasePrice: 10, shares: 0, type: 'aktien_neu', ticker: 'TEST', name: '<Test>' };
const sale = (id, date, before, amount, remaining) => ({ eventType: 'sale_reconciled', actionId: id, profileId: 'a', trancheId: 'lot', executedAt: date,
    actual: { sharesSold: amount, grossProceeds: amount * 10 }, result: { beforeShares: before, remainingShares: remaining } });
const events = freeze([sale('1', '2026-01-05', 10, 4, 6), sale('2', '2026-01-07', 6, 6, 0)]);
const lot = freeze({ tranche, remainingShares: 0, status: 'sold' });
const chain = reconstructHistoryShares(lot, [...events, events[0], { ...events[0], eventType: 'cash_posting_confirmed' }, { eventType: 'preview' }, { eventType: 'recommendation' }]);
for (const [day, expected] of [['2026-01-01', 0], ['2026-01-02', 10], ['2026-01-05', 6], ['2026-01-07', 0], ['2026-01-08', 0]]) assertEqual(historySharesAt(chain, d(day)), expected, 'Belegter Stückbestand ' + day);
let failed = false;
try { reconstructHistoryShares(lot, [events[0], { ...events[1], result: { beforeShares: 5, remainingShares: 0 } }]); } catch { failed = true; }
assert(failed, 'Widersprüchliche Stückbelege sind ein Fehler');
failed = false;
try { reconstructHistoryShares(lot, [events[0], { ...events[0], actual: { sharesSold: 3 } }]); } catch { failed = true; }
assert(failed, 'Widersprüchliche doppelte IDs sind ein Fehler');
const record = freeze({ currency: 'EUR', days: [d('2026-01-02'), d('2026-01-05')], closes: [10, 12], queried: [[d('2026-01-01'), d('2026-01-06')]] });
assertEqual(historyPriceAt(record, d('2026-01-01')).status, 'missing-first-price', 'Geprüft ist nicht bewertbar');
assertEqual(historyPriceAt(record, d('2026-01-06')).status, 'carried', 'Geprüfter Feiertag wird fortgeschrieben');
assertEqual(historyPriceAt(record, d('2026-01-06')).gap, false, 'Feiertag ist keine Lücke');
assertEqual(historyPriceAt(record, d('2026-01-07')).status, 'open-gap', 'Ungeprüfter Werktag getrennt');
assertEqual(historyPriceAt(record, d('2026-01-10')).gap, false, 'Ungefragtes Wochenende allein keine Lücke');
assertEqual(historyPriceAt({ ...record, currency: 'USD' }, d('2026-01-05')).status, 'unsupported-currency', 'Fremdwährung bleibt unbekannt');
const cash = freeze({ version: 1, baselineValue: 100, entries: [{ date: '2026-01-03', value: 90 }, { date: '2026-01-03', value: 85 }, { date: '2026-01-06', value: 100 }] });
assertEqual(historyCashAt(cash, 999, d('2026-01-02')).value, 100, 'Basis bleibt rückwirkend erhalten');
assertEqual(historyCashAt(cash, 999, d('2026-01-02')).assumed, true, 'Basis kenntlich');
assertEqual(historyCashAt(cash, 999, d('2026-01-03')).value, 85, 'Letzter bestätigter Tagesstand');
const points = [100, 120, 90, 110].map((total, index) => ({ day: d('2026-01-01') + index, total }));
const m = historyMetrics(freeze(points), 15);
assertEqual(m.change, 10, 'Feste Reihe: Veränderung +10');
assertEqual(m.adjusted, 25, 'Feste Reihe: ohne Entnahmen +25');
assertEqual(m.peak.value, 120, 'Höchststand 120');
assertEqual(m.peak.day, d('2026-01-02'), 'Höchstdatum');
assertEqual(m.drawdown.percent, 25, 'Größter Rückgang 25 %');
assertEqual(m.drawdown.from, d('2026-01-02'), 'Hochdatum');
assertEqual(m.drawdown.to, d('2026-01-03'), 'Tiefdatum');
assertEqual(historyMetrics([{ day: 1, total: 120 }, { day: 2, total: 120 }, { day: 3, total: 90 }, { day: 4, total: 90 }], 0).peak.day, 1, 'Frühester Gleichstand');
assertEqual(historyMetrics([{ day: 1, total: 10 }, { day: 2, total: 20 }], 0).drawdown.percent, 0, 'Steigende Reihe ohne Rückgang');
assertEqual(historyMetrics([{ day: 1, total: 0 }, { day: 2, total: 10 }], 0).percent, null, 'Nullbasis ohne Prozent');
assertEqual(historyMetrics([{ day: 1, total: 10 }], 0).drawdown, null, 'Einzelpunkt ohne Rückgang');
assertEqual(historyMetrics(points, null).adjusted, null, 'Unbekannte Entnahmen bleiben ohne bereinigte Kennzahl');
assertEqual(historyMetrics([...points, { day: 5, total: null }], 15).change, null, 'Unbekannte Tage werden nicht übergangen');
assertEqual(historyMetrics(points.map(point => ({ ...point, gap: true })), 15).status, 'provisional', 'Offene Kurse vorläufig');
for (const [today, period, expected] of [['2027-01-01', 'year', '2027-01-01'], ['2028-03-01', '12m', '2027-02-28'], ['2028-03-02', '12m', '2027-03-01'], ['2026-01-07', 'year', '2026-01-01']]) {
    const range = historyRange('2026-01-01', today, period);
    assertEqual(range.startDate, expected, 'Kalendergrenze ' + today + '/' + period);
    assertEqual(range.end, d(today) - 1, 'Bis gestern gekappt');
}
assertEqual(historyRange('2028-01-05', '2028-02-01', 'year').startDate, '2028-01-05', 'Am Beginn gekappt');
for (const [period, firstDate, secondDate, today] of [
    ['year', '2027-01-01', '2027-01-02', '2027-01-10'],
    ['all', '2026-01-01', '2026-01-02', '2027-01-10'],
    ['12m', '2026-01-09', '2026-01-10', '2027-01-10']
]) {
    const evaluateCash = entries => evaluateWealthHistory(freeze({
        profiles: [{ id: 'a', currentCash: entries.at(-1).value, lots: [],
            cashHistory: { version: 1, baselineValue: 1000, entries } }],
        startDate: '2026-01-01', today, period
    }));
    const first = evaluateCash([{ date: firstDate, value: 0 }]);
    assertEqual(first.range.startDate, firstDate, period + ': tatsächliche Zeitraumgrenze');
    assertEqual(first.points[0].total, 0, period + ': erster Tagesabschluss enthält Rückgang');
    assertEqual(first.metrics.change, 0, period + ': keine Veränderung nach erstem Tagesabschluss');
    assertEqual(first.metrics.withdrawals, 0, period + ': Rückgang am ersten Tag nicht nochmals als Entnahme');
    assertEqual(first.metrics.adjusted, 0, period + ': vollständiger Rückgang am ersten Tag ohne Doppelzählung');
    const partial = evaluateCash([{ date: firstDate, value: 750 }, { date: firstDate, value: 500 }]);
    assertEqual(partial.metrics.adjusted, 0, period + ': mehrere Rückgänge am ersten Tag bereits in V0');
    assertEqual(partial.metrics.adjustedPercent, 0, period + ': bereinigter Prozentsatz ohne Doppelzählung');
    const second = evaluateCash([{ date: secondDate, value: 0 }]);
    assertEqual(second.points[0].total, 1000, period + ': Basis vor Rückgang am zweiten Tag');
    assertEqual(second.metrics.change, -1000, period + ': Rückgang am zweiten Tag vollständig erfasst');
    assertEqual(second.metrics.withdrawals, 1000, period + ': Entnahme am zweiten Tag vollständig erfasst');
    assertEqual(second.metrics.adjusted, 0, period + ': Entnahme am zweiten Tag gleicht Veränderung aus');
    assertEqual(second.metrics.adjustedPercent, 0, period + ': bereinigte Prozentänderung am zweiten Tag');
    const end = evaluateCash([{ date: firstDate, value: 500 }, { date: historyRange('2026-01-01', today, period).endDate, value: 300 },
        { date: today, value: 0 }]);
    assertEqual(end.metrics.change, -200, period + ': letzter Tagesabschluss berücksichtigt, heute ausgeschlossen');
    assertEqual(end.metrics.withdrawals, 200, period + ': erster Tag ausgeschlossen, Endtag eingeschlossen, heute ausgeschlossen');
    assertEqual(end.metrics.adjusted, 0, period + ': Entnahmen konsistent zu beiden Tagesabschlüssen');
}
const profiles = freeze([{ id: 'a', currentCash: 100, cashHistory: cash, lots: [lot] },
    { id: 'b', currentCash: 20, cashHistory: { version: 1, baselineValue: 20, entries: [] }, lots: [] },
    { id: 'outside', belongsToHousehold: false, currentCash: 10000, lots: [] }]);
const input = freeze({ profiles, prices: { symbols: { TEST: record } }, events, startDate: '2026-01-01', today: '2026-01-09' });
const bytes = JSON.stringify(input), household = evaluateWealthHistory(input);
assertEqual(household.points[0].total, 120, 'Vor Kauf nur Haushaltstagesgeld');
assertEqual(household.points[1].total, 220, 'Kauf mit Tagesabschluss');
assertEqual(household.points[4].total, 177, 'Teilverkauf und Tagesgeldstufe');
assertEqual(household.points[6].total, 120, 'Totalverkauf aus Stammdatenkopie');
assertEqual(household.metrics.withdrawals, 15, 'Cashrückgänge ohne Verkaufserlöse');
const person = evaluateWealthHistory({ ...input, profileId: 'a' });
const asset = evaluateWealthHistory({ ...input, assetType: 'aktien_neu' });
assertEqual(person.points[4].total + 20, household.points[4].total, 'Person/Haushalt nachvollziehbar');
assertEqual(asset.points[4].total, 72, 'Anlageformsumme');
assertEqual(evaluateWealthHistory({ ...input, profileId: 'outside' }).points[0].total, 10000, 'Fremde Person einzeln sichtbar');
assertEqual(JSON.stringify(input), bytes, 'Tief eingefrorene Inputs bleiben unverändert');
assertEqual(JSON.stringify(evaluateWealthHistory(input)), JSON.stringify(household), 'Deterministische Projektion');
assertEqual(evaluateWealthHistory({ ...input, profiles: [{ id: 'a', currentCash: 0, lots: [] }] }).points[0].total, null, 'Alte Verkäufe ohne Stammdaten machen Historie unvollständig');
assert(Math.abs(evaluateHistoryCourse({ tranche, prices: input.prices, startDate: input.startDate, today: input.today }).percent - 20) < 1e-10, 'Kursentwicklung unabhängig vom Totalverkauf');

// Feiertag am Aufzeichnungsbeginn: unbekannter Chartpunkt bleibt, Messbasis folgt.
const holidayLot = { ...tranche, purchaseDate: '2025-12-15', purchasePrice: 100, shares: 10 };
const holidayInput = freeze({
    profiles: [{ id: 'a', currentCash: 100, cashHistory: { version: 1, baselineValue: 100, entries: [] }, lots: [holidayLot] }],
    prices: { symbols: { TEST: { currency: 'EUR', days: [d('2026-01-02'), d('2026-01-05'), d('2026-01-06')],
        closes: [100, 120, 110], queried: [[d('2026-01-01'), d('2026-01-06')]] } } },
    startDate: '2026-01-01', today: '2026-01-07', period: 'all'
});
const holidayBytes = JSON.stringify(holidayInput);
for (const period of ['all', 'year', '12m']) {
    const result = evaluateWealthHistory({ ...holidayInput, period }), m = result.metrics;
    assertEqual(result.points[0].total, null, period + ': erster Chartpunkt bleibt unbekannt');
    assertEqual(result.measurementStart, d('2026-01-02'), period + ': tatsächlicher Messbeginn');
    assertEqual(m.status, 'provisional', period + ': verschobener Messbeginn ist vorläufig');
    assertEqual(m.change, 100, period + ': Veränderung ab erster bewertbarer Basis');
    assertEqual(m.withdrawals, 0, period + ': keine erfundenen Entnahmen');
    assertEqual(m.adjusted, 100, period + ': bereinigte Veränderung');
    assert(Math.abs(m.percent - 100 / 1100 * 100) < 1e-10 && m.percent === m.adjustedPercent, period + ': Prozentbasis ist 1100');
    assertEqual(m.peak.value, 1300, period + ': Höchststand 1300');
    assertEqual(m.peak.day, d('2026-01-05'), period + ': Datum des Höchststands');
    assert(Math.abs(m.drawdown.percent - (1 - 1200 / 1300) * 100) < 1e-10, period + ': größter Rückgang mit korrektem Nenner');
    assertEqual(m.drawdown.from, d('2026-01-05'), period + ': Hochdatum');
    assertEqual(m.drawdown.to, d('2026-01-06'), period + ': Tiefdatum');
    const course = evaluateHistoryCourse({ ...holidayInput, tranche: holidayLot, period });
    assertEqual(course.points[0].value, null, period + ': Kurschart behält unbekannten Beginn');
    assertEqual(course.measurementStart, d('2026-01-02'), period + ': Depot-Messbeginn');
    assertEqual(course.status, 'provisional', period + ': Depotentwicklung vorläufig');
    assert(Math.abs(course.percent - 10) < 1e-10, period + ': Depotentwicklung ab 100, nicht Kaufpreis');
}
assertEqual(JSON.stringify(holidayInput), holidayBytes, 'Feiertagsprojektion verändert eingefrorenen Input nicht');

// Bestätigte Zwischenwerte bleiben erhalten; Entnahmen folgen ausschließlich Tagesabschlüssen.
const correctionValues = [5000, 500, 50, 4, 45, 450, 4500, 45000];
const correctionEntries = correctionValues.map(value => ({ date: '2026-01-03', value }));
const evaluateCorrections = (entries, today = '2026-01-04', extraProfiles = []) => evaluateWealthHistory(freeze({
    profiles: [{ id: 'a', currentCash: entries.at(-1)?.value ?? 50000, lots: [],
        cashHistory: { version: 1, baselineValue: 50000, entries } }, ...extraProfiles],
    startDate: '2026-01-01', today
}));
const correctionBytes = JSON.stringify(correctionEntries);
const corrections = evaluateCorrections(correctionEntries);
const closingOnly = evaluateCorrections([{ date: '2026-01-03', value: 45000 }]);
assertEqual(corrections.metrics.withdrawals, 5000, 'Tagesnetto: Zwischenwerte ergeben nur 5000 Entnahmen');
assertEqual(corrections.end.allocation.cash, 45000, 'Tagesnetto: letzter bestätigter Tagescash 45000');
assertEqual(corrections.metrics.adjusted, corrections.metrics.change + 5000, 'Tagesnetto: bereinigte Veränderung verwendet Nettorückgang');
assertEqual(JSON.stringify(corrections), JSON.stringify(closingOnly), 'Tagesnetto: Tagespunkte, Peak, Drawdown und Kennzahlen wie reine Schlusswerte');
assertEqual(JSON.stringify(correctionEntries), correctionBytes, 'Tagesnetto: eingefrorene Eintragsliste bleibt unverändert');
const nextEntries = [...correctionEntries];
for (const [date, value, today, expected] of [
    ['2026-01-04', 43000, '2026-01-05', 7000],
    ['2026-01-05', 60000, '2026-01-06', 7000],
    ['2026-01-06', 55000, '2026-01-07', 12000]
]) {
    nextEntries.push({ date, value });
    assertEqual(evaluateCorrections([...nextEntries], today).metrics.withdrawals, expected, 'Tagesnetto: kumulative Entnahmen bis ' + date);
}
assertEqual(evaluateCorrections([{ date: '2026-01-03', value: 4 }, { date: '2026-01-03', value: 50000 }]).metrics.withdrawals,
    0, 'Tagesnetto: intratägiger Rückgang mit vollständiger Erholung zählt nicht');
const depositProfile = { id: 'b', currentCash: 90000, lots: [], cashHistory: { version: 1, baselineValue: 100,
    entries: [{ date: '2026-01-03', value: 90000 }] } };
assertEqual(evaluateCorrections(correctionEntries, '2026-01-04', [depositProfile]).metrics.withdrawals,
    5000, 'Tagesnetto: Einzahlung einer anderen Person kompensiert Entnahmen nicht');
assertEqual(evaluateWealthHistory({ profiles: [{ id: 'a', currentCash: 45000, lots: [] }],
    startDate: '2026-01-01', today: '2026-01-04' }).metrics.withdrawals, 0, 'Tagesnetto: fehlende Historie nimmt konstantes Cash an');

// Gegenproben zu R-01: mehrere Bestätigungen vor/am V0 und nach dem Endabschluss.
for (const period of ['all', 'year', '12m']) {
    const range = historyRange('2025-12-30', '2027-01-07', period);
    const dateAt = offset => new Date((range.start + offset) * 86400000).toISOString().slice(0, 10);
    const entries = freeze([
        { date: dateAt(-1), value: 1 }, { date: dateAt(-1), value: 60000 },
        { date: dateAt(0), value: 4 }, { date: dateAt(0), value: 50000 },
        ...correctionValues.map(value => ({ date: dateAt(1), value })),
        { date: range.endDate, value: 4 }, { date: range.endDate, value: 43000 },
        { date: '2027-01-07', value: 0 }, { date: '2027-01-07', value: 1 }
    ]);
    const result = evaluateWealthHistory(freeze({ profiles: [{ id: 'a', currentCash: 1, lots: [],
        cashHistory: { version: 1, baselineValue: 70000, entries } }], startDate: '2025-12-30', today: '2027-01-07', period }));
    assertEqual(result.measurementStart, range.start, period + ': Tagesnetto erhält Zeitraum-Messbeginn');
    assertEqual(result.points[0].allocation.cash, 50000, period + ': Tagesnetto vor/am Messbeginn aktualisiert nur V0');
    assertEqual(result.end.allocation.cash, 43000, period + ': Tagesnetto ignoriert spätere Einträge');
    assertEqual(result.metrics.withdrawals, 7000, period + ': Tagesnetto zählt nur abgeschlossene Tage nach V0');
    assertEqual(result.metrics.adjusted, 0, period + ': Tagesnetto verwendet dieselbe Messbasis');

    const shortened = evaluateWealthHistory(freeze({ ...holidayInput, period,
        profiles: [{ ...holidayInput.profiles[0], currentCash: 1,
            cashHistory: { version: 1, baselineValue: 70000, entries: [
                { date: '2025-12-31', value: 4 }, { date: '2025-12-31', value: 65000 },
                { date: '2026-01-01', value: 1 }, { date: '2026-01-01', value: 60000 },
                { date: '2026-01-02', value: 4 }, { date: '2026-01-02', value: 50000 },
                ...correctionEntries, { date: '2026-01-07', value: 1 }
            ] } }] }));
    assertEqual(shortened.measurementStart, d('2026-01-02'), period + ': Tagesnetto folgt verkürztem Messbeginn');
    assertEqual(shortened.metrics.withdrawals, 5000, period + ': verkürzte Basis enthält alle Zwischenwerte am Messtag');
    assertEqual(shortened.metrics.change, -4900, period + ': Kursänderung und Cash ab tatsächlicher Basis');
    assertEqual(shortened.metrics.adjusted, 100, period + ': bereinigte Veränderung ab verkürzter Basis');
}

const withProfile = profile => ({ ...holidayInput, profiles: [{ ...holidayInput.profiles[0], ...profile }] });
for (const [label, profile, prices] of [
    ['unbekannte Stücke', { lots: [{ tranche: holidayLot, status: 'unknown', remainingShares: 10 }] }],
    ['fehlender Ticker', { lots: [{ ...holidayLot, ticker: '' }] }],
    ['fehlendes Cash', { currentCash: null, cashHistory: null }],
    ['Fremdwährung', {}, { symbols: { TEST: { ...holidayInput.prices.symbols.TEST, currency: 'USD' } } }],
    ['kein Kurs', {}, { symbols: {} }],
    ['später bekanntes Cash', { cashHistory: { version: 1, baselineValue: null, entries: [{ date: '2026-01-02', value: 100 }] } }]
]) {
    const result = evaluateWealthHistory({ ...withProfile(profile), prices: prices || holidayInput.prices });
    assertEqual(result.metrics.status, 'unavailable', label + ': keine vollständige Messreihe');
    assert(result.metrics.change === null && result.metrics.peak === null && result.metrics.drawdown === null,
        label + ': keine scheinbaren Veränderungs-/Hoch-/Rückgangwerte');
    assertEqual(result.measurementStart, null, label + ': kein erfundener Messbeginn');
}
// Ein nach Beginn fehlender Kurs bei einem weiteren Kauf darf keine Tagespunkte ausblenden.
for (const purchaseDate of ['2026-01-04', '2026-01-06']) {
    const result = evaluateWealthHistory(withProfile({ lots: [holidayLot, { ...holidayLot, trancheId: 'second', ticker: 'NOCOURSE', purchaseDate }] }));
    assertEqual(result.metrics.status, 'unavailable', purchaseDate + ': unbekannter Zwischen-/Endpunkt sperrt Kennzahlen');
    assert(result.metrics.change === null && result.metrics.peak === null && result.metrics.drawdown === null, 'Strenger Schutz der verbleibenden Messreihe');
}
for (const prices of [{ symbols: {} }, { symbols: { TEST: { ...holidayInput.prices.symbols.TEST, currency: 'USD' } } }]) {
    const course = evaluateHistoryCourse({ ...holidayInput, tranche: holidayLot, prices });
    assertEqual(course.status, 'unavailable', 'Ohne EUR-Kurs keine Depotentwicklung');
    assertEqual(course.percent, null, 'Ohne EUR-Kurs kein Prozentwert');
}
const predecessorPrices = { symbols: { TEST: { ...holidayInput.prices.symbols.TEST,
    days: [d('2025-12-31'), ...holidayInput.prices.symbols.TEST.days], closes: [80, 100, 120, 110] } } };
const predecessor = evaluateWealthHistory({ ...holidayInput, prices: predecessorPrices });
assertEqual(predecessor.measurementStart, d('2026-01-01'), 'Gespeicherter Vorgängerkurs erhält ursprüngliche Basis');
assertEqual(predecessor.metrics.change, 300, 'Vorgängerkurs bestimmt tatsächliche Veränderung');
const predecessorCourse = evaluateHistoryCourse({ ...holidayInput, tranche: holidayLot, prices: predecessorPrices });
assertEqual(predecessorCourse.status, 'complete', 'Geprüfte Kursreihe mit Vorgänger ist vollständig');
assert(Math.abs(predecessorCourse.percent - 37.5) < 1e-10, 'Depotentwicklung nutzt echten Vorgängerkurs');
const single = evaluateWealthHistory({ ...holidayInput, today: '2026-01-03' });
assert(single.metrics.percent === null && single.metrics.adjustedPercent === null && single.metrics.drawdown === null, 'Einzelpunkt erfindet keine Prozentwerte');
assertEqual(evaluateHistoryCourse({ ...holidayInput, tranche: holidayLot, today: '2026-01-03' }).percent, null, 'Depot-Einzelpunkt ohne Prozent');
const zero = evaluateWealthHistory({ ...holidayInput, profiles: [{ id: 'zero', currentCash: 100, lots: [],
    cashHistory: { version: 1, baselineValue: 0, entries: [{ date: '2026-01-06', value: 100 }] } }] });
assert(zero.metrics.percent === null && zero.metrics.adjustedPercent === null, 'Nullbasis bleibt ohne Prozentwerte');
const zeroCourse = evaluateHistoryCourse({ ...holidayInput, tranche: holidayLot,
    prices: { symbols: { TEST: { ...holidayInput.prices.symbols.TEST, closes: [0, 120, 110] } } } });
assertEqual(zeroCourse.percent, null, 'Auch Nullkursbasis erfindet keinen Prozentwert');
const shiftedCash = evaluateWealthHistory(withProfile({ currentCash: 70, cashHistory: { version: 1, baselineValue: 100,
    entries: [{ date: '2026-01-01', value: 95 }, { date: '2026-01-02', value: 80 }, { date: '2026-01-03', value: 70 }] } }));
assertEqual(shiftedCash.metrics.withdrawals, 10, 'Nur Rückgang nach neuem Messtag zählt als Entnahme');
assertEqual(shiftedCash.metrics.change, 90, 'Veränderung nutzt Cashabschluss am neuen Messtag');
assertEqual(shiftedCash.metrics.adjusted, 100, 'Rückgänge vor und am Messtag werden nicht doppelt gezählt');
assert(Math.abs(shiftedCash.metrics.adjustedPercent - 100 / 1080 * 100) < 1e-10, 'Bereinigte Basis mit Cashabschluss am Messtag');

// Bestandsunsicherheit ist zeitlich getrennt von Kurslücken; bekannte Beiträge
// werden vor der Aggregation erfasst, auch innerhalb derselben Anlageklasse.
{
    const valid = { ...holidayLot, trancheId: 'valid', shares: 2, purchaseDate: '2026-01-01' };
    const originalTranche = { ...valid, trancheId: 'uncertain', purchaseDate: '2026-01-05' };
    const uncertain = { tranche: { ...originalTranche, shares: 3 }, status: 'unknown', remainingShares: 3,
        uncertainty: { fromDate: '2026-01-05', originalTranche } };
    const fixture = freeze({ startDate: '2026-01-01', today: '2026-01-07', prices: predecessorPrices,
        profiles: [{ id: 'a', currentCash: 100, lots: [valid, uncertain] },
            { id: 'b', currentCash: 20, lots: [{ ...valid, trancheId: 'b-valid', shares: 1 }] },
            { id: 'outside', belongsToHousehold: false, currentCash: 9999, lots: [] }] });
    const bytes = JSON.stringify(fixture), result = evaluateWealthHistory(fixture);
    for (const point of result.points) {
        const price = historyPriceAt(predecessorPrices.symbols.TEST, point.day).value;
        assertEqual(point.known, 120 + 3 * price, 'Bekannte Haushaltssumme behält beide gültigen Tranchen plus Cash');
        assertEqual(point.byProfile.a.known, 100 + 2 * price, 'Gültige Tranche derselben Klasse bleibt in bekannter Personensumme');
        assertEqual(point.byProfile.b.total, 20 + price, 'Nicht betroffene Person bleibt vollständig bewertbar');
        if (point.day < d('2026-01-05')) {
            assertEqual(point.total, point.known, 'Vor gesicherter Existenz ist unbekannte Tranche null Beitrag');
            assert(!point.quality.includes('unknown-stock'), 'Vor Grenze keine Tagesunsicherheit');
        } else {
            assertEqual(point.total, null, 'Ab gesicherter Existenz ist Haushalt nur teilbewertbar');
            assertEqual(point.byProfile.a.total, null, 'Betroffene Person nur teilbewertbar');
            assertEqual(point.allocation.aktien_neu, null, 'Anlageklassentotal bleibt ehrlich unbekannt');
            assert(point.quality.includes('unknown-stock'), 'Konkreter Qualitätshinweis ab Grenze');
        }
    }
    assert(result.errors.some(error => error.includes('2026-01-05')), 'Diagnose nennt gesicherte Unsicherheitsgrenze');
    assertEqual(result.metrics.status, 'unavailable', 'Preispräfixregel überspringt Bestandsunsicherheit nicht');
    const beforeExistence = evaluateWealthHistory({ ...fixture, today: '2026-01-05' });
    assertEqual(beforeExistence.metrics.change, 60, 'Zeitraum ganz vor gesicherter Existenz bleibt trotz Diagnose messbar');
    assert(!result.events.some(event => event.name === uncertain.tranche.name && event.day === d('2026-01-05')), 'Unbekannte Tranche erzeugt keine Kauf-/Verkaufsmarke');
    const changedType = { ...uncertain, tranche: { ...uncertain.tranche, type: 'aktien_alt' } };
    for (const assetType of ['aktien_alt', 'aktien_neu']) {
        const filtered = evaluateWealthHistory({ ...fixture, assetType, profiles: [{ ...fixture.profiles[0], lots: [valid, changedType] }] });
        assertEqual(filtered.end.total, null, 'Alte und neue Anlageform behalten unbekannten Beitrag');
        assertEqual(filtered.end.known, assetType === 'aktien_neu' ? 220 : 0, 'Filter enthält nur gültige Beiträge seiner Anlageform');
    }
    // Altwriter überschrieb den echten Kauf am 02.01. mit dem 05.01.;
    // dieser verlorene Beginn darf weder aus Gleichheit noch Entfernung entstehen.
    const { mergeWealthLots } = await import('../app/profile/profile-wealth-history.js');
    for (const removed of [false, true]) {
        const legacy = { tranche: { ...originalTranche }, remainingShares: 2, status: 'unknown' };
        const alt = evaluateWealthHistory({ ...fixture, profiles: [{ id: 'a', currentCash: 100,
            lots: mergeWealthLots({ lots: { uncertain: legacy } }, removed ? [valid] : [valid, legacy.tranche]) }] });
        for (const point of alt.points) {
            assertEqual(point.total, null, 'Nicht gesicherter Altbeginn bleibt an jedem Tag unbekannt, entfernt=' + removed);
            assertEqual(point.known, 100 + 2 * historyPriceAt(predecessorPrices.symbols.TEST, point.day).value, 'Bekannte Beiträge trotz Altbestand');
            assert(point.quality.includes('unknown-stock-undated'), 'Altbestand hat eigenen Qualitätsgrund');
        }
        assert(alt.errors.some(error => error.includes('ursprünglicher Kaufbeginn nicht gesichert')), 'Altbestand erklärt verlorenen Beginn');
        assert(!Object.hasOwn(legacy, 'uncertainty'), 'Reine Modellprojektion erzeugt keine Altmetadaten');
    }
    const badDate = evaluateWealthHistory({ ...fixture, profiles: [{ id: 'a', currentCash: 100,
        lots: [{ ...uncertain, uncertainty: { ...uncertain.uncertainty, fromDate: '2026-02-29' } }, valid] }] });
    assert(badDate.points.every(point => point.total === null), 'Ungültige Unsicherheitsdatierung bleibt durchgehend unbekannt');
    const flatUnknown = evaluateWealthHistory({ ...fixture, profiles: [{ id: 'a', currentCash: 100, lots: [valid, { ...originalTranche, status: 'unknown' }] }] });
    assert(flatUnknown.points.every(point => point.total === null), 'Flacher unbekannter Bestand bleibt ohne gesicherte Herkunft konservativ');
    const badAudit = evaluateWealthHistory({ ...fixture, events: [events[0], { ...events[0], actual: { sharesSold: 9 } }] });
    assert(badAudit.points.every(point => point.total === null && point.byProfile.a.total === null), 'Widersprüchlicher Audit sperrt auch vor Kaufdatum');
    assertEqual(JSON.stringify(fixture), bytes, 'Datierte Projektion mutiert eingefrorene Eingaben nicht');
}

// Fehlende bestätigte Historien tragen die konstante rückwirkende Basis bei.
{
    const fixture = freeze({ startDate: '2026-01-01', today: '2026-01-04', profiles: [
        { id: 'a', currentCash: 80, lots: [], cashHistory: { version: 1, baselineValue: 100,
            entries: [{ date: '2026-01-02', value: 70 }, { date: '2026-01-02', value: 80 }, { date: '2026-01-03', value: 90 }] } },
        { id: 'b', currentCash: 50, lots: [] }
    ] });
    const before = JSON.stringify(fixture), mixed = evaluateWealthHistory(fixture);
    assertEqual(mixed.metrics.withdrawals, 20, 'A bestätigte Tagesabnahme plus B null; Auffüllung keine Entnahme');
    assertEqual(mixed.metrics.status, 'provisional', 'Fehlende Historie hält Haushalt vorläufig');
    assert(mixed.points.every(point => point.assumedCash), 'Rückwirkende Basisannahme bleibt zugänglich');
    const missing = evaluateWealthHistory({ ...fixture, profiles: fixture.profiles.map(p => ({ ...p, cashHistory: null })) });
    assertEqual(missing.metrics.withdrawals, 0, 'Beide fehlenden Historien ergeben null Entnahmen');
    assertEqual(missing.metrics.status, 'provisional', 'Beide fehlenden Historien bleiben vorläufig');
    for (const extra of [{ currentCash: null }, { currentCash: -1 }, { error: 'Beschädigte Tagesgeldhistorie' }]) {
        const unknown = evaluateWealthHistory({ ...fixture, profiles: [fixture.profiles[0], { ...fixture.profiles[1], ...extra }] });
        assertEqual(unknown.metrics.withdrawals, null, 'Unbekanntes oder beschädigtes Cash liefert keine scheinbare Null');
        assertEqual(unknown.metrics.status, 'unavailable', 'Beschädigte Quellen bleiben gesperrt');
    }
    assertEqual(evaluateWealthHistory({ ...fixture, assetType: 'gold' }).metrics.withdrawals, null, 'Nicht-Cash-Detail behält Nichtanwendbarkeit');
    assertEqual(JSON.stringify(fixture), before, 'Entnahmenprojektion verändert keine Eingabebytes');
}
