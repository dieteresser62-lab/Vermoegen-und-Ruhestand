/** Reine EUR-Testkurve; Epoche, Symbolhash und UTC-Kalender sind unveränderlich. */
export const SYNTHETIC_PRICE_SOURCE = 'Spielbereich · synthetische EUR-Kurse';
export const SYNTHETIC_MARKET_SOURCE = 'Spielbereich · synthetisch';
const aliases = Object.freeze({ IE00BK5BQT80: 'VWCE.DE', IE00B3RBWM25: 'VWRL.DE', LU0290358497: 'XEON.DE',
    IE00B4WXJJ64: 'EUNH.DE', DE000A0S9GB0: '4GLD.DE' });
export function syntheticSymbol(value) {
    const symbol = String(value ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9.^=-]{1,32}$/.test(symbol)) throw new Error('Ungültige Instrumentkennung im Spielbereich.');
    return aliases[symbol] || symbol;
}
export function syntheticDay(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Ungültiges Kursdatum.');
    const time = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error('Ungültiges Kursdatum.');
    return time / 86400000;
}
export const syntheticDate = day => new Date(day * 86400000).toISOString().slice(0, 10);
const weekday = day => ![0, 6].includes(new Date(day * 86400000).getUTCDay());
export function syntheticPrice(symbol, date) {
    symbol = syntheticSymbol(symbol);
    const day = syntheticDay(date), years = (day - syntheticDay('2016-01-01')) / 365.2425;
    // Eigene Kurven nur für die neuen Instrumente; bestehende Symbolkurse bleiben unverändert.
    if (symbol === 'EUNH.DE' || symbol === '4GLD.DE') {
        const bond = symbol === 'EUNH.DE';
        const base = bond ? 100 : 32, trend = bond ? 0.012 : 0.035;
        const wave = bond ? 0.004 * Math.sin(day / 93) + 0.002 * Math.cos(day / 31)
            : 0.045 * Math.sin(day / 71 + 2) + 0.018 * Math.cos(day / 23 + 1);
        return Math.max(0.000001, Number((base * Math.exp(trend * years + wave)).toFixed(6)));
    }
    let hash = 2166136261;
    for (const char of symbol) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    const moneyMarket = symbol === 'XEON.DE';
    const base = moneyMarket ? 100 : 45 + hash % 90;
    const trend = moneyMarket ? 0.018 : 0.028 + (hash % 19) / 1000;
    const wave = moneyMarket ? 0 : 0.025 * Math.sin(day / 37 + hash % 97) + 0.012 * Math.cos(day / 11 + hash % 41);
    return Math.max(0.000001, Number((base * Math.exp(trend * years + wave)).toFixed(6)));
}
export function syntheticQuote(symbol, testDate) {
    symbol = syntheticSymbol(symbol);
    let day = syntheticDay(testDate);
    while (!weekday(day)) day--;
    return { symbol, price: syntheticPrice(symbol, syntheticDate(day)), currency: 'EUR',
        asOf: day * 86400, source: SYNTHETIC_PRICE_SOURCE };
}
/** Einschließlich Ende/Testdatum; Wochenenden werden ohne Kurspunkt als abgefragt bestätigt. */
export function syntheticChart(symbol, interval, testDate) {
    symbol = syntheticSymbol(symbol);
    if (!Array.isArray(interval) || interval.length !== 2 || interval.some(day => !Number.isInteger(day)) || interval[0] > interval[1]) throw new Error('Ungültiges Kursintervall.');
    const end = Math.min(interval[1], syntheticDay(testDate));
    const days = [], closes = [];
    for (let day = interval[0]; day <= end; day++) if (weekday(day)) {
        days.push(day); closes.push(syntheticPrice(symbol, syntheticDate(day)));
    }
    return { currency: 'EUR', days, closes, interval: end >= interval[0] ? [interval[0], end] : null, source: SYNTHETIC_PRICE_SOURCE };
}
export function syntheticAnnualQuote(symbol, year, testDate) {
    assertSyntheticYear(year);
    const chart = syntheticChart(symbol, [syntheticDay(`${year}-12-27`), syntheticDay(`${year}-12-31`)], testDate);
    if (!chart.days.length) throw new Error('Kein synthetischer Jahresendkurs für diese Periode.');
    const day = chart.days.at(-1), asOf = syntheticDate(day);
    return { price: chart.closes.at(-1), date: new Date(`${asOf}T00:00:00Z`), asOf,
        ticker: syntheticSymbol(symbol), source: SYNTHETIC_PRICE_SOURCE, targetYear: year };
}

function assertSyntheticYear(year) {
    if (!Number.isInteger(year) || year < 1900 || year > 9999) throw new Error('Ungültiges Abschlussjahr im Spielbereich.');
}
function completedYearEnd(year, testDate) {
    assertSyntheticYear(year);
    const asOf = `${year}-12-31`;
    if (syntheticDay(testDate) <= syntheticDay(asOf)) throw new Error('Das synthetische Abschlussjahr ist noch nicht abgeschlossen.');
    return asOf;
}
/** Jahreswerte hängen ausschließlich vom abgeschlossenen Jahr ab. */
export function syntheticAnnualInflation(year, testDate) {
    const dataAsOf = completedYearEnd(year, testDate);
    return { year, rate: Number((1.5 + (((year % 16) + 16) % 16) / 10).toFixed(1)),
        source: SYNTHETIC_MARKET_SOURCE, dataAsOf };
}
export function syntheticAnnualCape(year, testDate) {
    const capeAsOf = completedYearEnd(year, testDate);
    const close = syntheticAnnualQuote('VWCE.DE', year, `${year}-12-31`).price;
    const reference = syntheticAnnualQuote('VWCE.DE', 2016, '2016-12-31').price;
    const ratio = close / reference;
    return { capeRatio: Number((20 + 15 * ratio / (1 + ratio)).toFixed(1)),
        capeAsOf, capeSource: SYNTHETIC_MARKET_SOURCE };
}
