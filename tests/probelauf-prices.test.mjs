import { syntheticPrice, syntheticQuote, syntheticChart, syntheticDay, syntheticAnnualQuote, syntheticAnnualInflation, syntheticAnnualCape, SYNTHETIC_MARKET_SOURCE } from '../app/shared/probelauf-prices.js';
import { marketPriceAdapter } from '../app/shared/market-price-adapter.js';
import { setAppTestDate } from '../app/shared/app-clock.js';
import { fetchProxyPrice, fetchProxySymbol, checkProxyHealth } from '../app/tranches/tranchen-price-service.js';
import { fetchHistoryChart } from '../app/tranches/tranchen-history-fetch.js';

const fetchBefore = globalThis.fetch;
let requests = 0;
globalThis.fetch = () => { requests++; throw new Error('Kursnetz ist im Probelauf verboten.'); };
try {
    const first = syntheticPrice('vwce.de', '2027-07-01');
    assertEqual(first, 144.304481, 'Fester bestehender ETF-Referenzkurs');
    for (const symbol of ['VWRL.DE', 'XEON.DE', 'UNBEKANNT.DE']) {
        const value = syntheticPrice(symbol, '2027-07-01');
        assert(value > 0 && Number.isFinite(value), 'Positive endliche Kurven');
        assert(value !== first, 'Stabile unterschiedliche Symbolkurven');
    }
    assertEqual(syntheticPrice(' VWCE.DE ', '2027-07-01'), first, 'Reihenfolge und Normalisierung ändern keinen Kurs');
    const reloaded = await import('../app/shared/probelauf-prices.js?reload=1');
    assertEqual(reloaded.syntheticPrice('VWCE.DE', '2027-07-01'), first, 'Reload besitzt keinen Zufallszustand');
    const weekend = syntheticQuote('IE00BK5BQT80', '2027-07-04');
    assertEqual(new Date(weekend.asOf * 1000).toISOString(), '2027-07-02T00:00:00.000Z', 'Wochenendquote am letzten Werktag mit festem UTC-Stichtag');
    assertEqual(weekend.currency, 'EUR', 'Nur EUR');
    const interval = [syntheticDay('2027-06-28'), syntheticDay('2027-07-06')];
    const chart = syntheticChart('VWCE.DE', interval, '2027-07-04');
    assertEqual(chart.days.length, 5, 'Chart enthält nur Montag bis Freitag');
    assertEqual(chart.interval[1], syntheticDay('2027-07-04'), 'Auch Wochenendende ist abgefragt');
    assertEqual(chart.closes.at(-1), weekend.price, 'Quote und Chart stimmen bytegenau überein');
    assertEqual(JSON.stringify(chart.closes), '[144.090015,144.158902,144.230796,144.304481,144.378731]', 'Bestehende Chartkurve bleibt unverändert');
    const annual = syntheticAnnualQuote('VWCE.DE', 2026, '2027-01-01');
    assertEqual(annual.price, syntheticQuote('VWCE.DE', '2026-12-31').price, 'Jahresendquote folgt derselben Kurve');
    setAppTestDate('2027-07-01');
    const quote = await fetchProxyPrice('IE00BK5BQT80');
    assertEqual(quote.price, first, 'Manuelle ISINquote ohne Suche im Netz');
    assertEqual(await fetchProxySymbol('ie00bk5bqt80'), 'VWCE.DE', 'Lokale ISINauflösung');
    assertEqual(await fetchProxySymbol('unbekannt.de'), 'UNBEKANNT.DE', 'Kopierte unbekannte Symbole bleiben lokal deterministisch');
    assertEqual(await fetchProxySymbol(''), null, 'Fehlende Kennung erfindet kein Instrument');
    const status = {};
    await checkProxyHealth(status);
    assert(status.textContent.includes('synthetische Kursquelle'), 'Healthprüfung ohne Netzwerk');
    const loaded = await fetchHistoryChart('VWCE.DE', interval, { deadline: 100, now: () => 0, fetchImpl: globalThis.fetch });
    assertEqual(loaded.days.at(-1), syntheticDay('2027-07-01'), 'Verlauf einschließlich Testdatum');
    assertEqual(loaded.closes.at(-1), quote.price, 'Produktiver Chart- und Quoteadapter stimmen überein');
    const aborted = new AbortController(); aborted.abort();
    let code;
    try { await fetchProxyPrice('VWCE.DE', undefined, { signal: aborted.signal }); } catch (error) { code = error.code; }
    assertEqual(code, 'REQUEST_ABORTED', 'Synthetische Quote respektiert Abbruch');
    try { await fetchProxyPrice('VWCE.DE', undefined, { deadline: 10, now: () => 10 }); } catch (error) { code = error.code; }
    assertEqual(code, 'STARTUP_TIMEOUT', 'Technische Deadline bleibt wirksam');
    setAppTestDate('2027-06-30');
    const backward = await fetchHistoryChart('VWCE.DE', interval, { deadline: 100, now: () => 0 });
    assertEqual(backward.days.at(-1), syntheticDay('2027-06-30'), 'Rückwärtssprung liefert keine späteren Kurse');
    assertEqual(requests, 0, 'Kein Kursnetzpfad erreicht');
    assertEqual(syntheticAnnualInflation(2026, '2027-01-02').rate, 2.5, 'Unabhängiger Inflationsreferenzwert 2026');
    assertEqual(syntheticAnnualInflation(2027, '2028-01-02').rate, 2.6, 'Unabhängiger Inflationsreferenzwert 2027');
    assertEqual(syntheticAnnualInflation(2032, '2033-01-02').rate, 1.5, 'Untere Bandgrenze');
    assertEqual(syntheticAnnualInflation(2031, '2032-01-02').rate, 3, 'Obere Bandgrenze');
    assertEqual(syntheticAnnualCape(2016, '2017-01-02').capeRatio, 27.5, 'CAPE am Referenzkurs');
    assertEqual(syntheticAnnualCape(2026, '2027-01-02').capeRatio, 28.5, 'Unabhängiges CAPE-Referenzbeispiel');
    const pairs = [], rates = new Set();
    for (let year = 2025; year <= 2060; year++) {
        const date = `${year + 1}-01-02`, later = `${year + 1}-10-08`;
        const inflation = syntheticAnnualInflation(year, date), cape = syntheticAnnualCape(year, date);
        rates.add(inflation.rate);
        assert(Number.isFinite(inflation.rate) && inflation.rate >= 1.5 && inflation.rate <= 3, 'Inflation im Jahresband');
        assert(Number.isFinite(cape.capeRatio) && cape.capeRatio >= 20 && cape.capeRatio <= 35, 'CAPE im Jahresband');
        assertEqual(inflation.dataAsOf, `${year}-12-31`, 'Fester Inflationsdatenstand');
        assertEqual(cape.capeAsOf, `${year}-12-31`, 'Fester CAPE-Datenstand');
        for (const [kind, expected, generator] of [['inflation', inflation, reloaded.syntheticAnnualInflation], ['cape', cape, reloaded.syntheticAnnualCape]]) {
            assertEqual(JSON.stringify(generator(year, later)), JSON.stringify(expected), 'Modulneuladen und späterer Testtag erhalten Jahresdaten');
            for (const profileId of ['muster_a', 'muster_b']) {
                setAppTestDate(later);
                assertEqual(JSON.stringify(marketPriceAdapter(kind, { year, profileId }, () => { requests++; })), JSON.stringify(expected), 'Profil und Testdatum ändern Jahreswert nicht');
            }
        }
        pairs.push({ price: syntheticAnnualQuote('VWCE.DE', year, date).price, cape: cape.capeRatio });
    }
    assert(rates.size > 1, 'Jahre unterscheiden sich');
    pairs.sort((a, b) => a.price - b.price);
    assert(pairs.every((pair, index) => !index || pair.cape >= pairs[index - 1].cape), 'Unabhängig nach VWCE-Kurs sortierte CAPEs fallen nicht');
    for (const kind of ['inflation', 'cape', 'annual']) for (const year of [1899, 10000, 2026.5, '2026', NaN]) {
        let rejected = false;
        try { marketPriceAdapter(kind, { year, symbol: 'VWCE.DE' }, () => { requests++; }); } catch { rejected = true; }
        assert(rejected, 'Ungültiges Jahresargument scheitert lokal');
    }
    for (const generator of [syntheticAnnualInflation, syntheticAnnualCape]) {
        let rejected = false;
        try { generator(2026, '2026-12-31'); } catch { rejected = true; }
        assert(rejected, 'Noch nicht abgeschlossenes Jahr erzeugt keine künftigen Daten');
    }
    assertEqual(marketPriceAdapter('annual', { symbol: 'VWCE.DE', year: 2026 }, () => { requests++; }).source, SYNTHETIC_MARKET_SOURCE, 'Jahres-ETF trägt allgemeine Herkunft');
    assertEqual(requests, 0, 'Auch ungültige Jahresdaten lösen keinen Netzfallback aus');
    setAppTestDate(null);
    let calls = 0;
    assertEqual(await marketPriceAdapter('quote', { symbol: 'VWCE.DE' }, () => { calls++; return 'Originalanbieter'; }), 'Originalanbieter', 'Normalmodus delegiert unverändert');
    assertEqual(calls, 1, 'Originalanbieter genau einmal');
    for (const kind of ['inflation', 'cape', 'annual']) {
        let delegated = 0;
        assertEqual(marketPriceAdapter(kind, { year: 2026 }, () => { delegated++; return 'Original'; }), 'Original', 'Jahresdaten ohne bestätigte Fachuhr delegieren');
        assertEqual(delegated, 1, 'Jahresprovider genau einmal');
    }
} finally { globalThis.fetch = fetchBefore; setAppTestDate(null); }
