// TH-1: Hinweis „Möglicher Split“ nur lesend, mit erfundenem Wertpapier.
import { detectPossibleSplit, splitHintHtml, SPLIT_HINT_DROP_SHARE, SPLIT_HINT_INFO } from '../app/tranches/tranche-split-hint.js';
import { readManagerHistoryContext } from '../app/tranches/tranchen-history-ui.js';
import { historyDay, WEALTH_HISTORY_START_KEY, DAILY_PRICES_KEY } from '../app/tranches/tranchen-history-store.js';
import { buildTranchenTableHtml } from '../app/tranches/tranchen-manager-renderer.js';

console.log('--- Möglicher Split (TH-1) ---');
const monday = historyDay('2026-03-02'), tuesday = monday + 1;
const prices = { version: 1, symbols: { 'MUSTER.DE': { currency: 'EUR', days: [monday - 3, monday], closes: [98, 100],
    queried: [[monday - 3, monday]], failures: 0, lastError: null } } };
const records = new Map([[WEALTH_HISTORY_START_KEY, JSON.stringify({ version: 1, startDate: '2026-01-01', confirmed: true })],
    [DAILY_PRICES_KEY, JSON.stringify(prices)]]);
let writes = 0;
const storage = { getItem: key => records.get(key) ?? null, setItem: () => { writes++; }, removeItem: () => { writes++; } };
const lot = currentPrice => ({ trancheId: 'muster-1', name: 'Muster Welt ETF', isin: '', ticker: 'muster.de', purchaseDate: '2025-01-02',
    shares: 10, purchasePrice: 80, currentPrice, costBasis: 800, marketValue: currentPrice * 10, tqf: 0.3, type: 'aktien_neu', asOf: tuesday * 86400 + 15 * 3600 });

const context = readManagerHistoryContext({ profiles: {} }, { storage, today: '2026-03-03' });
assertEqual(context.status, 'ready', 'Erfundener Kursrecord wird gelesen');
assertEqual(SPLIT_HINT_DROP_SHARE, 0.5, 'Grenze ist 50 %');

const html = price => buildTranchenTableHtml([lot(price)], { context, profileId: 'p1' });
assert(html(49).includes('data-split-hint') && html(49).includes('Möglicher Split'), '−51 % zeigt den Hinweis');
assert(html(49).includes('Handbuch.html#moeglicher-split'), 'ⓘ verweist auf den Handbuchabschnitt');
assert(!html(51).includes('data-split-hint'), '−49 % zeigt keinen Hinweis');
assert(!html(200).includes('data-split-hint'), '+100 % zeigt keinen Hinweis');
assertEqual(detectPossibleSplit(lot(49), prices)?.previousClose, 100, 'Vergleich mit dem letzten Schlusskurs vor dem Kurstag');

// Fehlender Vortageskurs: kein Kursrecord, nur gleichtägiger Schluss oder ein zu alter Schluss.
assertEqual(detectPossibleSplit(lot(49), { version: 1, symbols: {} }), null, 'Ohne Kursrecord kein Hinweis');
assertEqual(detectPossibleSplit({ ...lot(49), asOf: (monday - 3) * 86400 }, prices), null, 'Ohne früheren Schlusskurs kein Hinweis');
assertEqual(detectPossibleSplit({ ...lot(49), asOf: (monday + 30) * 86400 }, prices), null, 'Ein Monat alter Schlusskurs ist kein Tagesverlust');
assertEqual(detectPossibleSplit({ ...lot(49), asOf: undefined }, prices), null, 'Ohne Kursdatum kein Hinweis');
assertEqual(splitHintHtml(lot(49), { status: 'missing' }), '', 'Ohne Verlaufskontext kein Hinweis');

// TH-1b: Ungeprüfte Werktage zwischen Vergleichskurs und Kurstag unterdrücken den Hinweis (Codex-Gegenprobe).
const friday = monday - 3;
const record = (days, closes, queried) => ({ version: 1, symbols: { 'MUSTER.DE': { currency: 'EUR', days, closes, queried, failures: 0, lastError: null } } });
const at = day => ({ ...lot(49), asOf: day * 86400 + 15 * 3600 });
assertEqual(detectPossibleSplit(at(tuesday), record([friday], [100], [[friday, friday]])), null, 'Montag ungeprüft: kein Hinweis');
assertEqual(detectPossibleSplit(at(tuesday), record([friday, monday], [100, 60], [[friday, monday]])), null, 'Montag 60 nachgetragen: kein Hinweis');
assertEqual(detectPossibleSplit(at(monday), record([friday], [100], [[friday, friday]]))?.previousClose, 100, 'Freitag/Montag ohne Lücke mit −51 %: Hinweis');
assertEqual(detectPossibleSplit(at(tuesday), record([friday], [100], [[friday, monday]]))?.previousClose, 100, 'Abgefragter Feiertag ohne Schlusskurs: Hinweis');

assertEqual(writes, 0, 'Lesen und Anzeigen schreiben nie');
assert(SPLIT_HINT_INFO.includes('„Haushalt & Plan“') && SPLIT_HINT_INFO.includes('„Plan“'), 'ⓘ nennt beide Reiternamen');
assert(SPLIT_HINT_INFO.split(/[.!?](\s|$)/).filter(part => part && part.trim()).length <= 3, 'ⓘ hat höchstens drei Sätze');
console.log('✓ Möglicher Split OK');
